import { describe, expect, it } from 'vitest';
import { collectTaskImageRefs, collectTaskRowImageRefs, getTaskImageIdHash } from './task-images';

describe('task image references', () => {
  it('collects and deduplicates task image refs by role and id', () => {
    expect(collectTaskImageRefs({
      inputImageIds: ['img-a', 'img-a'],
      maskTargetImageId: 'img-a',
      maskImageId: 'mask-a',
      outputImages: ['out-a'],
      streamPartialImageIds: ['partial-a', 'partial-a'],
    })).toEqual([
      { imageId: 'img-a', role: 'input' },
      { imageId: 'img-a', role: 'mask-target' },
      { imageId: 'mask-a', role: 'mask' },
      { imageId: 'out-a', role: 'output' },
      { imageId: 'partial-a', role: 'partial' },
    ]);
  });

  it('reads legacy database rows that still store image refs as JSON text', () => {
    expect(collectTaskRowImageRefs({
      input_image_ids: JSON.stringify(['input-a']),
      mask_target_image_id: 'target-a',
      mask_image_id: 'mask-a',
      output_images: JSON.stringify(['output-a']),
      stream_partial_image_ids: JSON.stringify(['partial-a']),
    })).toEqual([
      { imageId: 'input-a', role: 'input' },
      { imageId: 'target-a', role: 'mask-target' },
      { imageId: 'mask-a', role: 'mask' },
      { imageId: 'output-a', role: 'output' },
      { imageId: 'partial-a', role: 'partial' },
    ]);
  });

  it('hashes long image identifiers into fixed length index keys', () => {
    const longImageId = `https://example.com/uploads/${'x'.repeat(2000)}.png`;
    const hash = getTaskImageIdHash(longImageId);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(getTaskImageIdHash(longImageId)).toBe(hash);
  });
});
