import { describe, it, expect } from 'vitest';
import { convertDownloadArtifact } from './download-artifact.js';

describe('convertDownloadArtifact', () => {
  it('throws, naming tangled as the limitation', () => {
    expect(() =>
      convertDownloadArtifact({
        uses: 'actions/download-artifact@v8',
        with: { name: 'cli' },
      }),
    ).toThrow(
      'Unsupported action "actions/download-artifact@v8": per-run artifacts have no tangled equivalent',
    );
  });
});
