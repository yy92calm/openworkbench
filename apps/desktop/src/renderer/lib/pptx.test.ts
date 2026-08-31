// Decks written with paragraph-level defaults (<a:pPr><a:defRPr …>) and bare
// runs are valid OOXML — PowerPoint/WPS resolve run formatting from the
// paragraph's defRPr. pptx-preview does not, so a 48 pt white bold title
// rendered as 18 px black (invisible on a dark slide). applyParagraphDefaults
// rewrites each slide into the explicit per-run form the previewer understands.
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { applyParagraphDefaults, dropMissingParts, normalizePptxForPreview } from './pptx';

const A = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`;
const P = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;

const wrap = (body: string) => `<p:sld ${P} ${A}><p:txBody>${body}</p:txBody></p:sld>`;

describe('applyParagraphDefaults', () => {
  it('copies the paragraph defRPr onto runs that have no rPr', () => {
    const xml = wrap(
      `<a:p><a:pPr algn="l"><a:defRPr sz="4800" b="1">` +
        `<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Arial"/>` +
        `</a:defRPr></a:pPr>` +
        `<a:r><a:t>Title</a:t></a:r></a:p>`,
    );
    const out = applyParagraphDefaults(xml);
    expect(out).toContain(`<a:rPr sz="4800" b="1">`);
    expect(out).toContain(
      `<a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>Title</a:t>`,
    );
  });

  it('fills only the gaps when a run already has an rPr — its own values win', () => {
    const xml = wrap(
      `<a:p><a:pPr><a:defRPr sz="4800" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:pPr>` +
        `<a:r><a:rPr sz="2000"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>x</a:t></a:r></a:p>`,
    );
    const out = applyParagraphDefaults(xml);
    // sz stays 2000, b is inherited; the run's own red fill is kept.
    expect(out).toContain(`sz="2000"`);
    expect(out).toMatch(/<a:rPr sz="2000" b="1">/);
    expect(out).toContain(`val="FF0000"`);
    expect(out.match(/val="FFFFFF"/g)).toHaveLength(1); // only in the defRPr itself
  });

  it('applies to every run and to field runs in the paragraph', () => {
    const xml = wrap(
      `<a:p><a:pPr><a:defRPr sz="1600"/></a:pPr>` +
        `<a:r><a:t>one</a:t></a:r><a:r><a:t>two</a:t></a:r>` +
        `<a:fld id="{X}" type="slidenum"><a:t>3</a:t></a:fld></a:p>`,
    );
    const out = applyParagraphDefaults(xml);
    expect(out.match(/<a:rPr sz="1600"\/>/g)).toHaveLength(3);
  });

  it('leaves paragraphs without a defRPr, and invalid XML, untouched', () => {
    const plain = wrap(`<a:p><a:r><a:t>plain</a:t></a:r></a:p>`);
    expect(applyParagraphDefaults(plain)).toBe(plain);
    expect(applyParagraphDefaults('<not-xml')).toBe('<not-xml');
  });
});

describe('dropMissingParts', () => {
  async function makeZip(ctXml: string, parts: Record<string, string>) {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', ctXml);
    for (const [name, content] of Object.entries(parts)) zip.file(name, content);
    return zip;
  }

  it('drops Override entries whose part is absent from the zip', async () => {
    const ct =
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="x-slideMaster"/>` +
      `<Override PartName="/ppt/slideMasters/slideMaster2.xml" ContentType="x-slideMaster"/>` +
      `<Override PartName="/ppt/slides/slide1.xml" ContentType="x-slide"/>` +
      `</Types>`;
    const zip = await makeZip(ct, {
      'ppt/slideMasters/slideMaster1.xml': '<m/>',
      'ppt/slides/slide1.xml': '<s/>',
    });
    const changed = await dropMissingParts(zip);
    const out = await zip.files['[Content_Types].xml'].async('string');
    expect(changed).toBe(true);
    expect(out).toContain('slideMaster1.xml');
    expect(out).toContain('slide1.xml');
    expect(out).not.toContain('slideMaster2.xml');
  });

  it('leaves a fully-consistent Content_Types untouched', async () => {
    const ct =
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Override PartName="/ppt/slides/slide1.xml" ContentType="x-slide"/>` +
      `</Types>`;
    const zip = await makeZip(ct, { 'ppt/slides/slide1.xml': '<s/>' });
    const changed = await dropMissingParts(zip);
    expect(changed).toBe(false);
  });
});

describe('normalizePptxForPreview', () => {
  async function makeBytes() {
    const zip = new JSZip();
    // Declare a second slideMaster that doesn't exist — the failure mode seen
    // in real WPS/generated decks that made pptx-preview return an empty deck.
    zip.file(
      '[Content_Types].xml',
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="x-slideMaster"/>` +
        `<Override PartName="/ppt/slideMasters/slideMaster2.xml" ContentType="x-slideMaster"/>` +
        `<Override PartName="/ppt/slides/slide1.xml" ContentType="x-slide"/>` +
        `</Types>`,
    );
    zip.file('ppt/slideMasters/slideMaster1.xml', '<m/>');
    zip.file('ppt/slides/slide1.xml', '<s/>');
    return zip.generateAsync({ type: 'arraybuffer' });
  }

  it('returns a zip whose missing-part Overrides are gone', async () => {
    const bytes = await makeBytes();
    const out = await normalizePptxForPreview(bytes);
    expect(out).not.toBe(bytes);
    const re = await JSZip.loadAsync(out);
    const ct = await re.files['[Content_Types].xml'].async('string');
    expect(ct).not.toContain('slideMaster2.xml');
    expect(ct).toContain('slide1.xml');
  });
});
