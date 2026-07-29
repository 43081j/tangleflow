import { it, expect, describe } from 'vitest';
import { convertCheckout } from './checkout.js';

describe('checkout', () => {
  it('converts no inputs to no clone config', () => {
    expect(convertCheckout({})).toEqual({});
  });

  it('maps fetch-depth, submodules and fetch-tags to clone', () => {
    expect(
      convertCheckout({
        with: { 'fetch-depth': 0, submodules: true, 'fetch-tags': false },
      }),
    ).toEqual({ clone: { depth: 0, submodules: true, tags: false } });
  });

  it('reads string-form inputs', () => {
    expect(
      convertCheckout({ with: { 'fetch-depth': '1', submodules: 'false' } }),
    ).toEqual({ clone: { depth: 1, submodules: false } });
  });

  it('treats recursive submodules as a submodule clone', () => {
    expect(convertCheckout({ with: { submodules: 'recursive' } })).toEqual({
      clone: { submodules: true },
    });
  });

  it('ignores unparseable inputs', () => {
    expect(convertCheckout({ with: { 'fetch-depth': 'shallow' } })).toEqual({});
  });
});
