import hijackStream from '..';
import assert from 'assert';
import { Readable } from 'stream';

describe('on regular streams', () => {
  it('reads data while no other data events come through', (done) => {
    const stream = new Readable({ read () { /* ignore */ } });
    stream.on('data', (chunk) => assert.strictEqual(chunk.toString(), 'afterdone'));
    const { restore } = hijackStream({
      stream,
      ondata: (chunk) => {
        switch (chunk.toString()) {
          case 'chunk1':
            stream.push('done');
            break;
          case 'done':
            restore();
            stream.push('afterdone');
            setImmediate(() => {
              done();
            });
            break;
          default:
            assert.fail(`Unexpected chunk ${chunk}`);
        }
      },
      onend: () => assert.fail('Unexpected EOF')
    });

    stream.push('chunk1');
  });

  it('reads data while no other data events come through (.read() variant)', (done) => {
    const stream = new Readable({ read () { /* ignore */ } });
    const { restore } = hijackStream({
      stream,
      ondata: (chunk) => {
        switch (chunk.toString()) {
          case 'chunk1':
            stream.push('done');
            break;
          case 'done':
            restore();
            stream.push('afterdone');
            setImmediate(() => {
              assert.strictEqual(stream.read().toString(), 'afterdone');
              done();
            });
            break;
          default:
            assert.fail(`Unexpected chunk ${chunk}`);
        }
      },
      onend: () => assert.fail('Unexpected EOF')
    });

    stream.push('chunk1');
  });
});
