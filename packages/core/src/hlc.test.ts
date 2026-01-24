import { describe, expect, it } from 'vitest';
import { compareHlc, createHlcState, observeHlc, tickHlc } from './hlc';

describe('hlc', () => {
  it('compareHlc orders by wallMs then counter then nodeId', () => {
    expect(compareHlc('1:0:a', '2:0:a')).toBeLessThan(0);
    expect(compareHlc('2:0:a', '2:1:a')).toBeLessThan(0);
    expect(compareHlc('2:1:a', '2:1:b')).toBeLessThan(0);
    expect(compareHlc('2:1:a', '2:1:a')).toBe(0);
  });

  it('tickHlc is monotonic for a node', () => {
    const s = createHlcState('n1');
    const a = tickHlc(s, 100);
    const b = tickHlc(s, 100);
    const c = tickHlc(s, 101);
    expect(compareHlc(a, b)).toBeLessThan(0);
    expect(compareHlc(b, c)).toBeLessThan(0);
  });

  it('observeHlc incorporates remote time/counter', () => {
    const s = createHlcState('n1');
    const local = tickHlc(s, 100);
    const next = observeHlc(s, '200:5:other', 150);
    expect(compareHlc(local, next)).toBeLessThan(0);
  });
});

