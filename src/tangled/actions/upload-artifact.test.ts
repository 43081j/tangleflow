import { describe, it, expect } from 'vitest';
import { convertUploadArtifact } from './upload-artifact.js';

describe('convertUploadArtifact', () => {
  it('throws, naming tangled as the limitation', () => {
    expect(() =>
      convertUploadArtifact({
        uses: 'actions/upload-artifact@v4',
        with: { name: 'cli', path: 'dist/cli' },
      }),
    ).toThrow(
      'Unsupported action "actions/upload-artifact@v4": per-run artifacts have no tangled equivalent',
    );
  });
});
