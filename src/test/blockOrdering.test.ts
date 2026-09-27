import { describe, it, expect } from 'vitest';
import { generateKeyBetween } from 'fractional-indexing';

describe('fractional-indexing block ordering', () => {
  it('generates a key between null and null', () => {
    const key = generateKeyBetween(null, null);
    expect(key).toBeTruthy();
    expect(typeof key).toBe('string');
  });

  it('generates a key after an existing key', () => {
    const first = generateKeyBetween(null, null);
    const second = generateKeyBetween(first, null);
    expect(second > first).toBe(true);
  });

  it('generates a key between two existing keys', () => {
    const first = generateKeyBetween(null, null);
    const third = generateKeyBetween(first, null);
    const second = generateKeyBetween(first, third);
    expect(second > first).toBe(true);
    expect(second < third).toBe(true);
  });

  it('generates many sequential keys in correct order', () => {
    const keys: string[] = [];
    let prev: string | null = null;
    for (let i = 0; i < 100; i++) {
      const key = generateKeyBetween(prev, null);
      keys.push(key);
      prev = key;
    }
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] > keys[i - 1]).toBe(true);
    }
  });

  it('generates keys between adjacent keys without collision', () => {
    let a = generateKeyBetween(null, null);
    let b = generateKeyBetween(a, null);
    for (let i = 0; i < 20; i++) {
      const mid = generateKeyBetween(a, b);
      expect(mid > a).toBe(true);
      expect(mid < b).toBe(true);
      a = mid;
    }
  });
});
