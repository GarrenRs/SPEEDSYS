type ExportCell = string | number | boolean | null | undefined;

const textEncoder = new TextEncoder();

function toFileName(value: string, extension: string): string {
  const trimmed = value.trim() || 'report';
  const safe = trimmed
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 120);
  return `${safe}.${extension}`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function csvEscape(value: ExportCell): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function downloadCsvReport(fileBaseName: string, headers: string[], rows: ExportCell[][]): void {
  const csvLines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    csvLines.push(row.map(csvEscape).join(','));
  }
  const csvContent = `\uFEFF${csvLines.join('\r\n')}`;
  downloadBlob(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }), toFileName(fileBaseName, 'csv'));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(indexOneBased: number): string {
  let result = '';
  let n = indexOneBased;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result || 'A';
}

function toCellXml(rowIndexOneBased: number, colIndexZeroBased: number, value: ExportCell): string {
  const ref = `${columnName(colIndexZeroBased + 1)}${rowIndexOneBased}`;
  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}" t="inlineStr"><is><t></t></is></c>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
}

function buildSheetXml(headers: string[], rows: ExportCell[][]): string {
  const allRows: ExportCell[][] = [headers, ...rows];
  const rowXml = allRows
    .map((row, rowIndex) => {
      const cells = row.map((cell, colIndex) => toCellXml(rowIndex + 1, colIndex, cell)).join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  out[0] = value & 0xff;
  out[1] = (value >>> 8) & 0xff;
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = value & 0xff;
  out[1] = (value >>> 8) & 0xff;
  out[2] = (value >>> 16) & 0xff;
  out[3] = (value >>> 24) & 0xff;
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function buildZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);

    const localHeader = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);
    localParts.push(localHeader, data);

    const centralHeader = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const localSection = concatBytes(localParts);
  const endRecord = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(localSection.length),
    u16(0),
  ]);
  return concatBytes([localSection, centralDirectory, endRecord]);
}

export function downloadXlsxReport(fileBaseName: string, sheetName: string, headers: string[], rows: ExportCell[][]): void {
  const safeSheetName = (sheetName || 'Report').replace(/[\[\]:*?/\\]/g, '').slice(0, 31) || 'Report';
  const nowIso = new Date().toISOString();
  const sheetXml = buildSheetXml(headers, rows);

  const files: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: textEncoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`),
    },
    {
      name: '_rels/.rels',
      data: textEncoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`),
    },
    {
      name: 'docProps/core.xml',
      data: textEncoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Restaurant System</dc:creator>
  <cp:lastModifiedBy>Restaurant System</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified>
</cp:coreProperties>`),
    },
    {
      name: 'docProps/app.xml',
      data: textEncoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Restaurant System</Application>
</Properties>`),
    },
    {
      name: 'xl/workbook.xml',
      data: textEncoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(safeSheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: textEncoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: textEncoder.encode(sheetXml),
    },
  ];

  const zipBytes = buildZip(files);
  downloadBlob(
    new Blob([zipBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    toFileName(fileBaseName, 'xlsx')
  );
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function openPdfPrintView(title: string, headers: string[], rows: ExportCell[][]): void {
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=800');
  if (!popup) {
    window.alert('تعذر فتح نافذة التصدير. تأكد من السماح بالنوافذ المنبثقة.');
    return;
  }

  const headerHtml = headers.map((item) => `<th>${htmlEscape(item)}</th>`).join('');
  const rowsHtml = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${htmlEscape(cell == null ? '' : String(cell))}</td>`).join('')}</tr>`)
    .join('');

  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${htmlEscape(title)}</title>
  <style>
    body { font-family: Tahoma, Arial, sans-serif; margin: 24px; color: #111827; }
    h1 { margin: 0 0 12px; font-size: 20px; }
    p { margin: 0 0 14px; font-size: 12px; color: #4b5563; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #d1d5db; padding: 8px; font-size: 12px; vertical-align: top; word-break: break-word; }
    th { background: #f3f4f6; font-weight: 700; }
    @page { size: A4 landscape; margin: 12mm; }
  </style>
</head>
<body>
  <h1>${htmlEscape(title)}</h1>
  <p>تاريخ التصدير: ${new Date().toLocaleString('ar-DZ-u-nu-latn')}</p>
  <table>
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="' + headers.length + '">لا توجد بيانات.</td></tr>'}</tbody>
  </table>
</body>
</html>`);
  popup.document.close();
  popup.focus();
  setTimeout(() => {
    popup.print();
  }, 300);
}

