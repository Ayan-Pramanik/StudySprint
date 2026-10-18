import test from 'node:test';
import assert from 'node:assert/strict';
import {imageReferences,markdownImage} from '../lib/markdown-images.ts';
test('image parsing preserves bracket captions and resolves reference images',()=>{const text='![A \\[label\\]](../assets/a.png)\n\n![Diagram][ref]\n\n[ref]: <images/with spaces.png>';const images=imageReferences(text);assert.equal(images.length,2);assert.equal(images[0].alt,'A [label]');assert.equal(images[1].url,'images/with spaces.png');assert.equal(imageReferences(markdownImage(images[0].alt,'asset:123'))[0].alt,'A [label]');});
test('image examples in fenced and inline code are never resolved as attachments',()=>{assert.deepEqual(imageReferences('```md\n![Example](code.png)\n```\n\n`![Example](inline.png)`'),[]);});
