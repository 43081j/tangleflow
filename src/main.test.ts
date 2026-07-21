import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { describe, it, expect } from 'vitest';
import { convertWorkflowFile } from './main.js';

const fixturesDir = fileURLToPath(new URL('../test/fixtures', import.meta.url));

const fixtures = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe('convertWorkflowFile', () => {
  it.each(fixtures)('handles the %s fixture', async (name) => {
    const dir = `${fixturesDir}/${name}`;

    try {
      const pipeline = await convertWorkflowFile(`${dir}/github.yml`);
      const yaml = stringify(pipeline, { aliasDuplicateObjects: false });
      await expect(yaml).toMatchFileSnapshot(`${dir}/tangled.yml`);
    } catch (error) {
      await expect(`${(error as Error).message}\n`).toMatchFileSnapshot(
        `${dir}/error.txt`,
      );
    }
  });

  it('rejects when the file does not exist', async () => {
    await expect(
      convertWorkflowFile(`${fixturesDir}/does-not-exist/github.yml`),
    ).rejects.toThrow();
  });
});
