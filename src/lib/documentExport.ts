import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  InstitutionProfile,
  ProposalAttachment,
  ProposalBudget,
  ProposalRecord,
  RabItem,
  SystemAppSettings,
} from '../types/models';
import {
  formatAngka,
  formatRupiah,
  formatTanggalLengkapIndonesia,
  terbilangRupiah,
} from './formatters';

interface LoadedImageAsset {
  bytes: Uint8Array;
  dataUrl: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

async function fetchImageAsset(url: string | undefined): Promise<LoadedImageAsset | null> {
  if (!url || !url.trim()) return null;
  const trimmed = url.trim();
  if (
    !trimmed.startsWith('/api/uploads/') &&
    !trimmed.startsWith('data:image/') &&
    !trimmed.startsWith('http://') &&
    !trimmed.startsWith('https://')
  ) {
    return null;
  }

  try {
    let dataUrl = trimmed;
    if (!trimmed.startsWith('data:image/')) {
      const res = await fetch(trimmed);
      if (!res.ok) return null;
      const blob = await res.blob();
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Gagal membaca gambar'));
        reader.readAsDataURL(blob);
      });
    }

    // Normalize any image (including WebP) via canvas into PNG/JPEG so both docx and jsPDF support it natively
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Gagal memuat gambar'));
      el.src = dataUrl;
    });

    const maxW = 1000;
    const scale = Math.min(1, maxW / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || 100) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 100) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);

    const isPngSource = dataUrl.startsWith('data:image/png');
    const outMime: 'image/png' | 'image/jpeg' = isPngSource ? 'image/png' : 'image/jpeg';
    const normalizedDataUrl = canvas.toDataURL(outMime, 0.88);
    const base64 = normalizedDataUrl.split(',')[1] || '';
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }

    return {
      bytes,
      dataUrl: normalizedDataUrl,
      mimeType: outMime,
      width,
      height,
    };
  } catch {
    return null;
  }
}

function groupRabItems(items: RabItem[]): Array<{
  groupName: string;
  items: RabItem[];
  subtotal: number;
}> {
  const map = new Map<string, RabItem[]>();
  for (const item of items) {
    const key = (item.groupName || 'Pekerjaan Umum').trim() || 'Pekerjaan Umum';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return Array.from(map.entries()).map(([groupName, groupItems]) => ({
    groupName,
    items: groupItems,
    subtotal: groupItems.reduce((sum, it) => sum + (Number(it.totalPrice) || 0), 0),
  }));
}

function buildInstitutionAddressLine(inst: InstitutionProfile | null): string {
  if (!inst) return '';
  return [
    inst.address,
    inst.kecamatan ? `Kec. ${inst.kecamatan}` : '',
    inst.kabupaten ? `Kab. ${inst.kabupaten}` : '',
    inst.provinsi || '',
    inst.negara || '',
  ]
    .filter(Boolean)
    .join(', ');
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFileSlug(title: string): string {
  const clean = (title || 'proposal')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return clean || 'proposal';
}

export async function exportProposalToDocx(params: {
  proposal: ProposalRecord;
  institution: InstitutionProfile | null;
  budget?: ProposalBudget | null;
  attachments?: ProposalAttachment[];
  appSettings?: SystemAppSettings;
}): Promise<void> {
  const { proposal, institution, budget, attachments = [], appSettings } = params;
  const instName = institution?.name?.trim() || 'LEMBAGA';
  const addressLine = buildInstitutionAddressLine(institution);
  const contactLine = [
    institution?.phone ? `Telp: ${institution.phone}` : '',
    institution?.email ? `Email: ${institution.email}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const logoAsset =
    appSettings?.includeLogoInLetterhead !== false && institution?.logoUrl
      ? await fetchImageAsset(institution.logoUrl)
      : null;

  const children: Array<Paragraph | Table> = [];

  // Letterhead Table (Logo + Institution Details)
  const letterheadCells: TableCell[] = [];
  if (logoAsset) {
    const ratio = logoAsset.height / Math.max(1, logoAsset.width);
    const w = 68;
    const h = Math.max(36, Math.min(80, Math.round(w * ratio)));
    letterheadCells.push(
      new TableCell({
        width: { size: 15, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          bottom: { style: BorderStyle.DOUBLE, size: 12, color: '0F3D2E' },
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                data: logoAsset.bytes,
                type: logoAsset.mimeType === 'image/png' ? 'png' : 'jpg',
                transformation: { width: w, height: h },
              }),
            ],
          }),
        ],
      })
    );
  }

  letterheadCells.push(
    new TableCell({
      width: { size: logoAsset ? 85 : 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.DOUBLE, size: 12, color: '0F3D2E' },
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [
            new TextRun({
              text: instName.toUpperCase(),
              bold: true,
              size: 28,
              color: '0F3D2E',
              font: 'Calibri',
            }),
          ],
        }),
        ...(addressLine
          ? [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 30 },
                children: [new TextRun({ text: addressLine, size: 19, color: '334155', font: 'Calibri' })],
              }),
            ]
          : []),
        ...(contactLine
          ? [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 40 },
                children: [new TextRun({ text: contactLine, size: 18, color: '475569', font: 'Calibri' })],
              }),
            ]
          : []),
      ],
    })
  );

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ children: letterheadCells })],
    })
  );

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 320, after: 100 },
      children: [
        new TextRun({
          text: 'PROPOSAL PENGAJUAN',
          bold: true,
          size: 26,
          color: '0F3D2E',
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 280 },
      children: [
        new TextRun({
          text: proposal.title.toUpperCase(),
          bold: true,
          size: 24,
          color: '111C18',
          font: 'Calibri',
        }),
      ],
    })
  );

  // Proposal Metadata Table
  const metaRows: Array<[string, string]> = [
    ['Nomor Proposal', proposal.proposalNumber || '-'],
    ['Tanggal Pengajuan', formatTanggalLengkapIndonesia(proposal.proposalDate || proposal.createdAt)],
    ['Kategori / Tahun', `${proposal.categoryName || 'Umum'} · Tahun ${proposal.fiscalYear}`],
    [
      'Kepada Yth.',
      [proposal.recipientName, proposal.recipientInstitution].filter(Boolean).join(' — ') || '-',
    ],
    ['Lokasi Pelaksanaan', proposal.location || addressLine || '-'],
    ['Total Kebutuhan Anggaran', formatRupiah(budget ? budget.totalAmount : proposal.totalBudget)],
  ];

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: metaRows.map(
        ([k, v]) =>
          new TableRow({
            children: [
              new TableCell({
                width: { size: 32, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({
                    spacing: { before: 40, after: 40 },
                    children: [new TextRun({ text: k, bold: true, size: 20, font: 'Calibri' })],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 68, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({
                    spacing: { before: 40, after: 40 },
                    children: [new TextRun({ text: v, size: 20, font: 'Calibri' })],
                  }),
                ],
              }),
            ],
          })
      ),
    })
  );

  // Enabled Sections
  const enabledSections = [...(proposal.sections || [])]
    .filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order);

  for (const sec of enabledSections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 280, after: 100 },
        children: [
          new TextRun({
            text: sec.title,
            bold: true,
            size: 23,
            color: '0F3D2E',
            font: 'Calibri',
          }),
        ],
      })
    );
    const bodyText = (sec.content || '').trim() || sec.description || '-';
    for (const line of bodyText.split(/\r?\n/)) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 90, line: 276 },
          children: [new TextRun({ text: line, size: 21, font: 'Calibri' })],
        })
      );
    }
  }

  // RAB Table
  if (budget && budget.items.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 320, after: 140 },
        children: [
          new TextRun({
            text: 'LAMPIRAN I: RENCANA ANGGARAN BIAYA (RAB)',
            bold: true,
            size: 23,
            color: '0F3D2E',
            font: 'Calibri',
          }),
        ],
      })
    );

    const groups = groupRabItems(budget.items);
    const rabRows: TableRow[] = [
      new TableRow({
        tableHeader: true,
        children: ['No', 'Uraian Pekerjaan / Barang', 'Vol', 'Satuan', 'Harga Satuan', 'Jumlah']
          .map((h, i) => {
            const widths = [7, 37, 10, 12, 17, 17];
            return new TableCell({
              width: { size: widths[i], type: WidthType.PERCENTAGE },
              shading: { fill: '0F3D2E' },
              children: [
                new Paragraph({
                  alignment: i >= 4 || i === 2 ? AlignmentType.RIGHT : AlignmentType.LEFT,
                  spacing: { before: 60, after: 60 },
                  children: [
                    new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 19, font: 'Calibri' }),
                  ],
                }),
              ],
            });
          }),
      }),
    ];

    let rowNo = 1;
    for (const grp of groups) {
      rabRows.push(
        new TableRow({
          children: [
            new TableCell({
              columnSpan: 6,
              shading: { fill: 'F1F5F9' },
              children: [
                new Paragraph({
                  spacing: { before: 50, after: 50 },
                  children: [
                    new TextRun({
                      text: grp.groupName,
                      bold: true,
                      size: 20,
                      color: '0F3D2E',
                      font: 'Calibri',
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );

      for (const item of grp.items) {
        rabRows.push(
          new TableRow({
            children: [
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: String(rowNo++), size: 19, font: 'Calibri' })],
                  }),
                ],
              }),
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: item.description, size: 19, font: 'Calibri' })],
                  }),
                ],
              }),
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [new TextRun({ text: formatAngka(item.volume), size: 19, font: 'Calibri' })],
                  }),
                ],
              }),
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: item.unit, size: 19, font: 'Calibri' })],
                  }),
                ],
              }),
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [new TextRun({ text: formatRupiah(item.unitPrice), size: 19, font: 'Calibri' })],
                  }),
                ],
              }),
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [new TextRun({ text: formatRupiah(item.totalPrice), size: 19, font: 'Calibri' })],
                  }),
                ],
              }),
            ],
          })
        );
      }

      rabRows.push(
        new TableRow({
          children: [
            new TableCell({
              columnSpan: 5,
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: `Subtotal ${grp.groupName}`,
                      bold: true,
                      size: 19,
                      font: 'Calibri',
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: formatRupiah(grp.subtotal),
                      bold: true,
                      size: 19,
                      font: 'Calibri',
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    }

    rabRows.push(
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 5,
            shading: { fill: 'ECFDF5' },
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { before: 60, after: 60 },
                children: [
                  new TextRun({
                    text: 'TOTAL ANGGARAN BIAYA',
                    bold: true,
                    size: 20,
                    color: '0F3D2E',
                    font: 'Calibri',
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            shading: { fill: 'ECFDF5' },
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { before: 60, after: 60 },
                children: [
                  new TextRun({
                    text: formatRupiah(budget.totalAmount),
                    bold: true,
                    size: 20,
                    color: '0F3D2E',
                    font: 'Calibri',
                  }),
                ],
              }),
            ],
          }),
        ],
      })
    );

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rabRows,
      }),
      new Paragraph({
        spacing: { before: 120, after: 200 },
        children: [
          new TextRun({
            text: `Terbilang: ${terbilangRupiah(budget.totalAmount)}.`,
            italics: true,
            bold: true,
            size: 20,
            font: 'Calibri',
          }),
        ],
      })
    );
  }

  // Attachments / Documentation Photos
  if (attachments.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 320, after: 140 },
        children: [
          new TextRun({
            text: 'LAMPIRAN II: DOKUMENTASI & BERKAS PENDUKUNG',
            bold: true,
            size: 23,
            color: '0F3D2E',
            font: 'Calibri',
          }),
        ],
      })
    );

    for (const att of attachments) {
      children.push(
        new Paragraph({
          spacing: { before: 140, after: 60 },
          children: [
            new TextRun({
              text: `${att.title} (${att.category})`,
              bold: true,
              size: 20,
              font: 'Calibri',
            }),
          ],
        })
      );
      if (att.description) {
        children.push(
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: att.description, size: 19, color: '475569', font: 'Calibri' })],
          })
        );
      }
      if (att.isImage) {
        const asset = await fetchImageAsset(att.fileUrl);
        if (asset) {
          const ratio = asset.height / Math.max(1, asset.width);
          const w = 360;
          const h = Math.max(120, Math.min(340, Math.round(w * ratio)));
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 160 },
              children: [
                new ImageRun({
                  data: asset.bytes,
                  type: asset.mimeType === 'image/png' ? 'png' : 'jpg',
                  transformation: { width: w, height: h },
                }),
              ],
            })
          );
        }
      } else {
        children.push(
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: `Dokumen PDF terlampir: ${att.fileName}`,
                italics: true,
                size: 19,
                font: 'Calibri',
              }),
            ],
          })
        );
      }
    }
  }

  // Signature Block
  const city =
    appSettings?.letterCity?.trim() || institution?.kabupaten?.trim() || 'Tempat';
  const signDate = formatTanggalLengkapIndonesia(proposal.proposalDate || new Date());
  children.push(
    new Paragraph({ spacing: { before: 400 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 40 },
      children: [new TextRun({ text: `${city}, ${signDate}`, size: 21, font: 'Calibri' })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 760 },
      children: [
        new TextRun({
          text: `Pimpinan ${institution?.name?.trim() || 'Lembaga'},`,
          bold: true,
          size: 21,
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({
          text: institution?.leaderName?.trim() || '( ........................................ )',
          bold: true,
          underline: {},
          size: 21,
          font: 'Calibri',
        }),
      ],
    })
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906, // A4 width in twips
              height: 16838, // A4 height in twips
            },
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  triggerBlobDownload(blob, `${safeFileSlug(proposal.title)}.docx`);
}

export async function exportProposalToPdf(params: {
  proposal: ProposalRecord;
  institution: InstitutionProfile | null;
  budget?: ProposalBudget | null;
  attachments?: ProposalAttachment[];
  appSettings?: SystemAppSettings;
}): Promise<void> {
  const { proposal, institution, budget, attachments = [], appSettings } = params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;

  let y = 18;
  const instName = institution?.name?.trim() || 'LEMBAGA';
  const addressLine = buildInstitutionAddressLine(institution);
  const contactLine = [
    institution?.phone ? `Telp: ${institution.phone}` : '',
    institution?.email ? `Email: ${institution.email}` : '',
  ]
    .filter(Boolean)
    .join('  |  ');

  const logoAsset =
    appSettings?.includeLogoInLetterhead !== false && institution?.logoUrl
      ? await fetchImageAsset(institution.logoUrl)
      : null;

  if (logoAsset) {
    const ratio = logoAsset.height / Math.max(1, logoAsset.width);
    const lw = 18;
    const lh = Math.max(12, Math.min(20, lw * ratio));
    doc.addImage(
      logoAsset.dataUrl,
      logoAsset.mimeType === 'image/png' ? 'PNG' : 'JPEG',
      margin,
      y,
      lw,
      lh
    );
  }

  const textCenterX = logoAsset ? pageWidth / 2 + 8 : pageWidth / 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 61, 46);
  doc.text(instName.toUpperCase(), textCenterX, y + 6, { align: 'center', maxWidth: contentWidth - 22 });

  let headerY = y + 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  if (addressLine) {
    const addrLines = doc.splitTextToSize(addressLine, contentWidth - (logoAsset ? 24 : 0));
    doc.text(addrLines, textCenterX, headerY, { align: 'center' });
    headerY += addrLines.length * 4.2;
  }
  if (contactLine) {
    doc.text(contactLine, textCenterX, headerY + 1, { align: 'center' });
    headerY += 5;
  }

  y = Math.max(y + 22, headerY + 3);
  doc.setDrawColor(15, 61, 46);
  doc.setLineWidth(0.7);
  doc.line(margin, y, pageWidth - margin, y);
  doc.setLineWidth(0.25);
  doc.line(margin, y + 1.2, pageWidth - margin, y + 1.2);
  y += 10;

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 61, 46);
  doc.text('PROPOSAL PENGAJUAN', pageWidth / 2, y, { align: 'center' });
  y += 6.5;

  doc.setFontSize(12);
  doc.setTextColor(17, 28, 24);
  const titleLines = doc.splitTextToSize(proposal.title.toUpperCase(), contentWidth);
  doc.text(titleLines, pageWidth / 2, y, { align: 'center' });
  y += titleLines.length * 5.5 + 4;

  // Metadata summary box
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2.5, textColor: [30, 41, 59] },
    columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold', fillColor: [248, 250, 249] } },
    body: [
      ['Nomor Proposal', proposal.proposalNumber || '-'],
      ['Tanggal Pengajuan', formatTanggalLengkapIndonesia(proposal.proposalDate || proposal.createdAt)],
      ['Kategori / Tahun', `${proposal.categoryName || 'Umum'} / Tahun ${proposal.fiscalYear}`],
      [
        'Ditujukan Kepada',
        [proposal.recipientName, proposal.recipientInstitution].filter(Boolean).join(' — ') || '-',
      ],
      ['Lokasi Pelaksanaan', proposal.location || addressLine || '-'],
      ['Total Anggaran', formatRupiah(budget ? budget.totalAmount : proposal.totalBudget)],
    ],
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > pageHeight - 20) {
      doc.addPage();
      y = 20;
    }
  };

  // Sections
  const enabledSections = [...(proposal.sections || [])]
    .filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order);

  for (const sec of enabledSections) {
    ensureSpace(18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 61, 46);
    doc.text(sec.title, margin, y);
    y += 5.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    const text = (sec.content || '').trim() || sec.description || '-';
    const paragraphs = text.split(/\r?\n/);
    for (const p of paragraphs) {
      if (!p.trim()) {
        y += 3;
        continue;
      }
      const wrapped = doc.splitTextToSize(p, contentWidth);
      for (const line of wrapped) {
        ensureSpace(6);
        doc.text(line, margin, y);
        y += 4.8;
      }
      y += 2;
    }
    y += 3;
  }

  // RAB Table
  if (budget && budget.items.length > 0) {
    ensureSpace(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 61, 46);
    doc.text('LAMPIRAN I: RENCANA ANGGARAN BIAYA (RAB)', margin, y);
    y += 4;

    const groups = groupRabItems(budget.items);
    const bodyRows: Array<Array<string | { content: string; colSpan?: number; styles?: Record<string, unknown> }>> = [];
    let no = 1;
    for (const grp of groups) {
      bodyRows.push([
        {
          content: grp.groupName,
          colSpan: 6,
          styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 61, 46] },
        },
      ]);
      for (const item of grp.items) {
        bodyRows.push([
          String(no++),
          item.description,
          formatAngka(item.volume),
          item.unit,
          formatRupiah(item.unitPrice),
          formatRupiah(item.totalPrice),
        ]);
      }
      bodyRows.push([
        {
          content: `Subtotal ${grp.groupName}`,
          colSpan: 5,
          styles: { halign: 'right', fontStyle: 'bold' },
        },
        {
          content: formatRupiah(grp.subtotal),
          styles: { halign: 'right', fontStyle: 'bold' },
        },
      ]);
    }
    bodyRows.push([
      {
        content: 'TOTAL ANGGARAN BIAYA',
        colSpan: 5,
        styles: { halign: 'right', fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [15, 61, 46] },
      },
      {
        content: formatRupiah(budget.totalAmount),
        styles: { halign: 'right', fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [15, 61, 46] },
      },
    ]);

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['No', 'Uraian', 'Vol', 'Satuan', 'Harga Satuan', 'Jumlah']],
      body: bodyRows as never,
      headStyles: { fillColor: [15, 61, 46], textColor: 255, fontSize: 8.5 },
      styles: { fontSize: 8.5, cellPadding: 2.2 },
      columnStyles: {
        0: { cellWidth: 10 },
        2: { halign: 'right', cellWidth: 14 },
        3: { cellWidth: 18 },
        4: { halign: 'right', cellWidth: 30 },
        5: { halign: 'right', cellWidth: 32 },
      },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
    ensureSpace(10);
    doc.setFont('helvetica', 'bolditalic');
    doc.setFontSize(9.5);
    doc.setTextColor(17, 28, 24);
    const terbilangLines = doc.splitTextToSize(`Terbilang: ${terbilangRupiah(budget.totalAmount)}.`, contentWidth);
    doc.text(terbilangLines, margin, y);
    y += terbilangLines.length * 4.5 + 6;
  }

  // Attachments
  if (attachments.length > 0) {
    ensureSpace(22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 61, 46);
    doc.text('LAMPIRAN II: DOKUMENTASI & BERKAS PENDUKUNG', margin, y);
    y += 7;

    for (const att of attachments) {
      ensureSpace(16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(17, 28, 24);
      doc.text(`${att.title} (${att.category})`, margin, y);
      y += 4.5;
      if (att.description) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(71, 85, 105);
        doc.text(att.description, margin, y);
        y += 4.5;
      }
      if (att.isImage) {
        const asset = await fetchImageAsset(att.fileUrl);
        if (asset) {
          const ratio = asset.height / Math.max(1, asset.width);
          const imgW = 100;
          const imgH = Math.max(40, Math.min(85, imgW * ratio));
          ensureSpace(imgH + 6);
          doc.addImage(
            asset.dataUrl,
            asset.mimeType === 'image/png' ? 'PNG' : 'JPEG',
            (pageWidth - imgW) / 2,
            y,
            imgW,
            imgH
          );
          y += imgH + 6;
        }
      } else {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8.5);
        doc.text(`Berkas PDF terlampir: ${att.fileName}`, margin, y);
        y += 5;
      }
    }
  }

  // Signature block
  ensureSpace(40);
  const city =
    appSettings?.letterCity?.trim() || institution?.kabupaten?.trim() || 'Tempat';
  const signDate = formatTanggalLengkapIndonesia(proposal.proposalDate || new Date());
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(17, 28, 24);
  doc.text(`${city}, ${signDate}`, pageWidth - margin, y, { align: 'right' });
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text(`Pimpinan ${institution?.name?.trim() || 'Lembaga'},`, pageWidth - margin, y, {
    align: 'right',
  });
  y += 22;
  doc.text(
    institution?.leaderName?.trim() || '( ........................................ )',
    pageWidth - margin,
    y,
    { align: 'right' }
  );

  // Page footer numbers
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    if (appSettings?.footerText) {
      doc.text(appSettings.footerText, margin, pageHeight - 10);
    }
    doc.text(`Halaman ${i} dari ${totalPages}`, pageWidth - margin, pageHeight - 10, {
      align: 'right',
    });
  }

  doc.save(`${safeFileSlug(proposal.title)}.pdf`);
}

export function exportSummaryReportToPdf(params: {
  institutionName: string;
  proposals: ProposalRecord[];
  filterLabel: string;
}): void {
  const { institutionName, proposals, filterLabel } = params;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 61, 46);
  doc.text(`LAPORAN REKAPITULASI PROPOSAL - ${institutionName.toUpperCase()}`, 14, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Filter: ${filterLabel} · Dicetak: ${formatTanggalLengkapIndonesia(new Date())}`,
    14,
    22
  );

  const totalPengajuan = proposals.reduce((s, p) => s + (Number(p.totalBudget) || 0), 0);
  const totalDisetujui = proposals.reduce((s, p) => s + (Number(p.approvedAmount) || 0), 0);
  const totalDiterima = proposals.reduce((s, p) => s + (Number(p.receivedAmount) || 0), 0);

  autoTable(doc, {
    startY: 27,
    head: [
      [
        'No',
        'Nomor Proposal',
        'Judul Proposal',
        'Kategori',
        'Tahun',
        'Instansi Tujuan',
        'Status',
        'Nilai Pengajuan',
        'Disetujui',
        'Diterima',
      ],
    ],
    body: [
      ...proposals.map((p, i) => [
        String(i + 1),
        p.proposalNumber || '-',
        p.title,
        p.categoryName || 'Umum',
        String(p.fiscalYear),
        p.recipientInstitution || '-',
        p.status,
        formatRupiah(p.totalBudget),
        formatRupiah(p.approvedAmount),
        formatRupiah(p.receivedAmount),
      ]),
      [
        { content: 'TOTAL', colSpan: 7, styles: { halign: 'right', fontStyle: 'bold' } } as never,
        { content: formatRupiah(totalPengajuan), styles: { halign: 'right', fontStyle: 'bold' } } as never,
        { content: formatRupiah(totalDisetujui), styles: { halign: 'right', fontStyle: 'bold' } } as never,
        { content: formatRupiah(totalDiterima), styles: { halign: 'right', fontStyle: 'bold' } } as never,
      ],
    ],
    headStyles: { fillColor: [15, 61, 46], fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 2 },
  });

  doc.save(`laporan-proposal-${new Date().toISOString().slice(0, 10)}.pdf`);
}
