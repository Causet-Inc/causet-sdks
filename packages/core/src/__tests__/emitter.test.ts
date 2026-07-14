import { describe, expect, it } from 'vitest';
import { Emitter } from '../emitter.js';

describe('Emitter', () => {
  it('on and emit deliver data to handler', () => {
    const em = new Emitter();
    const received: unknown[] = [];
    em.on('click', (data) => received.push(data));
    em.emit('click', { x: 1 });
    expect(received).toEqual([{ x: 1 }]);
  });

  it('unsubscribe stops further events', () => {
    const em = new Emitter();
    const received: unknown[] = [];
    const unsub = em.on('click', (data) => received.push(data));
    em.emit('click', 'a');
    unsub();
    em.emit('click', 'b');
    expect(received).toEqual(['a']);
  });

  it('wildcard receives all event types', () => {
    const em = new Emitter();
    const received: Array<[string, unknown]> = [];
    em.on('*', (eventType, data) => received.push([eventType, data]));
    em.emit('click', 1);
    em.emit('hover', 2);
    expect(received).toEqual([
      ['click', 1],
      ['hover', 2],
    ]);
  });

  it('wildcard unsubscribe works', () => {
    const em = new Emitter();
    const received: unknown[] = [];
    const unsub = em.on('*', (_et, data) => received.push(data));
    em.emit('e', 1);
    unsub();
    em.emit('e', 2);
    expect(received).toEqual([1]);
  });

  it('handler errors do not propagate', () => {
    const em = new Emitter();
    const received: unknown[] = [];
    em.on('e', () => {
      throw new Error('boom');
    });
    em.on('e', (data) => received.push(data));
    em.emit('e', 'ok');
    expect(received).toEqual(['ok']);
  });

  it('wildcard handler errors do not propagate', () => {
    const em = new Emitter();
    const received: unknown[] = [];
    em.on('*', () => {
      throw new Error('boom');
    });
    em.on('e', (data) => received.push(data));
    em.emit('e', 'ok');
    expect(received).toEqual(['ok']);
  });

  it('multiple handlers on same event all fire', () => {
    const em = new Emitter();
    const r1: unknown[] = [];
    const r2: unknown[] = [];
    em.on('e', (d) => r1.push(d));
    em.on('e', (d) => r2.push(d));
    em.emit('e', 42);
    expect(r1).toEqual([42]);
    expect(r2).toEqual([42]);
  });

  it('emit with no handlers is safe', () => {
    const em = new Emitter();
    em.emit('nothing', 'data');
    em.emit('click', null);
  });

  it('emit defaults data to null', () => {
    const em = new Emitter();
    const received: unknown[] = [];
    em.on('e', (d) => received.push(d));
    em.emit('e');
    expect(received).toEqual([null]);
  });
});
