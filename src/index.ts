import type { Readable } from 'stream';
import type { ReadStream } from 'tty';
import type { EventEmitter } from 'events';

type Options = {
  stream: Readable | ReadStream;
  ondata: (chunk: Buffer | string) => void;
  onend: (err: null | Error) => void;
  ttyRawMode?: boolean;
};

function saveAndRemoveListeners (ee: EventEmitter, ...events: string[]): { restore(): void } {
  // eslint-disable-next-line @typescript-eslint/ban-types
  const listenerStore: { [key: string]: Function[] } = {};
  for (const event of events) {
    listenerStore[event] = ee.rawListeners(event);
    ee.removeAllListeners(event);
  }
  return {
    restore () {
      for (const event of events) {
        for (const listener of listenerStore[event]) {
          ee.addListener(event, listener as () => void);
        }
      }
    }
  };
}

interface StreamController {
  restore(unshiftData?: Buffer | string): void;
}

function hijackStream (options: Options): StreamController {
  const { stream } = options;

  const isTTY: boolean = 'isTTY' in stream && stream.isTTY;
  let wasRaw: boolean | null = false;
  let streamEnded = false;
  let wasReset = false;
  let origSetRawMode = null;
  const wasFlowing: boolean | null = stream.readableFlowing ?? null;

  const originalListeners = saveAndRemoveListeners(stream, 'readable', 'data', 'keypress');

  if (isTTY && options.ttyRawMode !== false) {
    const rs = stream as ReadStream;
    wasRaw = rs.isRaw;
    rs.setRawMode(true);
    origSetRawMode = rs.setRawMode;
    rs.setRawMode = (value) => {
      wasRaw = null; // Mark wasRaw as explicitly overriden.
      rs.setRawMode = origSetRawMode;
      return rs.setRawMode(value);
    };
  }
  stream.prependListener('data', ondata);
  stream.prependListener('error', onerror);
  stream.prependListener('close', onclose);
  stream.prependListener('end', onend);

  if (!wasFlowing) {
    stream.resume();
  }

  function reset () {
    if (wasReset) {
      throw new Error('Tried to reset stream twice!');
    }
    wasReset = true;
    stream.removeListener('data', ondata);
    stream.removeListener('error', onerror);
    stream.removeListener('close', onclose);
    stream.removeListener('end', onend);
    originalListeners.restore();
    if (isTTY && wasRaw !== null) {
      (stream as ReadStream).setRawMode(wasRaw);
    }
    if (origSetRawMode !== null) {
      (stream as ReadStream).setRawMode = origSetRawMode;
    }
    if (wasFlowing === false) {
      stream.pause();
    } else if (wasFlowing === null) {
      // There is no way to get a stream back into `readableFlowing = null`,
      // unfortunately. We do our best to emulate that.
      stream.pause();
      const onnewlistener = (event) => {
        if (event === 'data' || event === 'readable') {
          stream.resume();
        }
      };
      const onresume = () => {
        stream.removeListener('newListener', onnewlistener);
        stream.removeListener('resume', onresume);
      };
      stream.addListener('newListener', onnewlistener);
      stream.addListener('resume', onresume);
    }
  }

  function ondata (input) {
    options.ondata(input);
  }

  function onend () {
    streamEnded = true;
    reset();
    options.onend(null);
  }

  function onerror (err) {
    streamEnded = true;
    reset();
    options.onend(err);
  }

  function onclose () {
    streamEnded = true;
    reset();
    options.onend(new Error('Stream closed before data could be read'));
  }

  return {
    restore (unshiftData?: Buffer|string) {
      reset();
      if (unshiftData?.length > 0 && !streamEnded) {
        stream.unshift(unshiftData);
      }
    }
  };
}

export = hijackStream;
