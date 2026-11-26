import { Fragment, useState } from 'react';
import { Building2, Download, FileText, X } from 'lucide-react';
import {
  InstitutionProfile,
  ProposalAttachment,
  ProposalBudget,
  ProposalRecord,
  SystemAppSettings,
} from '../types/models';
import {
  formatAngka,
  formatRupiah,
  formatTanggalLengkapIndonesia,
  terbilangRupiah,
} from '../lib/formatters';
import { isSafeImageUrl } from '../lib/imageUtils';
import { exportProposalToDocx, exportProposalToPdf } from '../lib/documentExport';
import { useToast } from './Toast';

interface ProposalPreviewModalProps {
  proposal: ProposalRecord;
  institution: InstitutionProfile | null;
  budget?: ProposalBudget | null;
  attachments: ProposalAttachment[];
  appSettings: SystemAppSettings;
  onClose: () => void;
}

export function ProposalPreviewModal({
  proposal,
  institution,
  budget,
  attachments,
  appSettings,
  onClose,
}: ProposalPreviewModalProps) {
  const { showToast } = useToast();
  const [exporting, setExporting] = useState<'docx' | 'pdf' | null>(null);

  const addressLine = [
    institution?.address,
    institution?.kecamatan ? `Kec. ${institution.kecamatan}` : '',
    institution?.kabupaten ? `Kab. ${institution.kabupaten}` : '',
    institution?.provinsi || '',
    institution?.negara || '',
  ]
    .filter(Boolean)
    .join(', ');

  const enabledSections = [...(proposal.sections || [])]
    .filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order);

  const groupedRab = (() => {
    const map = new Map<string, NonNullable<typeof budget>['items']>();
    for (const it of budget?.items || []) {
      const k = it.groupName || 'Pekerjaan Umum';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return Array.from(map.entries()).map(([groupName, items]) => ({
      groupName,
      items,
      subtotal: items.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0),
    }));
  })();

  const handleExport = async (type: 'docx' | 'pdf') => {
    setExporting(type);
    try {
      if (type === 'docx') {
        await exportProposalToDocx({
          proposal,
          institution,
          budget,
          attachments,
          appSettings,
        });
        showToast('Dokumen Word (.docx) berhasil diunduh.', 'success');
      } else {
        await exportProposalToPdf({
          proposal,
          institution,
          budget,
          attachments,
          appSettings,
        });
        showToast('Dokumen PDF (A4) berhasil diunduh.', 'success');
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Gagal mengekspor dokumen proposal.',
        'error'
      );
    } finally {
      setExporting(null);
    }
  };

  const safeLogo =
    appSettings.includeLogoInLetterhead && isSafeImageUrl(institution?.logoUrl)
      ? institution!.logoUrl!
      : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <div>
            <h3 className="font-display text-sm font-bold text-[#111C18]">
              Pratinjau Dokumen Resmi A4
            </h3>
            <p className="text-xs text-slate-500">
              Siap diekspor ke Microsoft Word (.docx) atau PDF (.pdf)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => handleExport('docx')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#0F3D2E] hover:bg-slate-100 disabled:opacity-60"
            >
              <Download className="h-3.5 w-3.5" />
              {exporting === 'docx' ? 'Menyiapkan...' : 'Unduh Word (.docx)'}
            </button>
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => handleExport('pdf')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F3D2E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
            >
              <FileText className="h-3.5 w-3.5" />
              {exporting === 'pdf' ? 'Menyiapkan...' : 'Unduh PDF (A4)'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
              aria-label="Tutup pratinjau"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable A4 Paper */}
        <div className="flex-1 overflow-y-auto bg-slate-200/70 p-4 sm:p-8">
          <article className="mx-auto max-w-[794px] rounded bg-white p-8 sm:p-12 shadow-md text-[#111C18]">
            {/* Kop Surat */}
            <header className="flex items-center gap-4 border-b-4 border-double border-[#0F3D2E] pb-4">
              {safeLogo ? (
                <img
                  src={safeLogo}
                  alt="Logo"
                  className="h-16 w-16 shrink-0 object-contain"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50">
                  <Building2 className="h-7 w-7 text-[#0F3D2E]" />
                </div>
              )}
              <div className="flex-1 text-center">
                <h1 className="font-display text-lg font-bold uppercase tracking-wide text-[#0F3D2E]">
                  {institution?.name?.trim() || 'PROFIL LEMBAGA BELUM DIISI'}
                </h1>
                {addressLine && <p className="mt-0.5 text-xs text-slate-600">{addressLine}</p>}
                {(institution?.phone || institution?.email) && (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {[
                      institution?.phone ? `Telp: ${institution.phone}` : '',
                      institution?.email ? `Email: ${institution.email}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>
            </header>

            {/* Judul Proposal */}
            <div className="my-6 text-center">
              <p className="text-xs font-bold tracking-widest text-[#0F3D2E]">
                PROPOSAL PENGAJUAN
              </p>
              <h2 className="mt-1.5 font-display text-lg font-bold uppercase text-[#111C18]">
                {proposal.title}
              </h2>
            </div>

            {/* Tabel Identitas Proposal */}
            <table className="mb-6 w-full border-collapse border border-slate-300 text-xs">
              <tbody>
                <tr>
                  <td className="w-48 border border-slate-300 bg-slate-50 px-3 py-2 font-semibold">
                    Nomor Proposal
                  </td>
                  <td className="border border-slate-300 px-3 py-2 font-mono">
                    {proposal.proposalNumber || '-'}
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 bg-slate-50 px-3 py-2 font-semibold">
                    Tanggal Pengajuan
                  </td>
                  <td className="border border-slate-300 px-3 py-2">
                    {formatTanggalLengkapIndonesia(proposal.proposalDate || proposal.createdAt)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 bg-slate-50 px-3 py-2 font-semibold">
                    Kategori / Tahun
                  </td>
                  <td className="border border-slate-300 px-3 py-2">
                    {proposal.categoryName || 'Umum'} · Tahun {proposal.fiscalYear}
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 bg-slate-50 px-3 py-2 font-semibold">
                    Ditujukan Kepada
                  </td>
                  <td className="border border-slate-300 px-3 py-2">
                    {[proposal.recipientName, proposal.recipientInstitution]
                      .filter(Boolean)
                      .join(' — ') || '-'}
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 bg-slate-50 px-3 py-2 font-semibold">
                    Total Anggaran Biaya
                  </td>
                  <td className="border border-slate-300 px-3 py-2 font-mono font-semibold text-[#0F3D2E]">
                    {formatRupiah(budget ? budget.totalAmount : proposal.totalBudget)}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Bab Narasi */}
            <div className="space-y-5">
              {enabledSections.map((sec) => (
                <section key={sec.id}>
                  <h3 className="font-display text-sm font-bold text-[#0F3D2E]">
                    {sec.title}
                  </h3>
                  <div className="mt-1.5 whitespace-pre-line text-justify text-xs leading-relaxed text-slate-800">
                    {sec.content?.trim() || sec.description || '-'}
                  </div>
                </section>
              ))}
            </div>

            {/* RAB */}
            {budget && budget.items.length > 0 && (
              <section className="mt-8">
                <h3 className="font-display text-sm font-bold text-[#0F3D2E]">
                  LAMPIRAN I: RENCANA ANGGARAN BIAYA (RAB)
                </h3>
                <table className="mt-2.5 w-full border-collapse border border-slate-300 text-xs">
                  <thead>
                    <tr className="bg-[#0F3D2E] text-white">
                      <th className="border border-slate-300 px-2 py-2 text-left">No</th>
                      <th className="border border-slate-300 px-2 py-2 text-left">Uraian</th>
                      <th className="border border-slate-300 px-2 py-2 text-right">Vol</th>
                      <th className="border border-slate-300 px-2 py-2 text-left">Satuan</th>
                      <th className="border border-slate-300 px-2 py-2 text-right">Harga Satuan</th>
                      <th className="border border-slate-300 px-2 py-2 text-right">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let idxCounter = 1;
                      return groupedRab.map((grp) => (
                        <Fragment key={grp.groupName}>
                          <tr className="bg-slate-100">
                            <td
                              colSpan={6}
                              className="border border-slate-300 px-2 py-1.5 font-semibold text-[#0F3D2E]"
                            >
                              {grp.groupName}
                            </td>
                          </tr>
                          {grp.items.map((item) => (
                            <tr key={item.id}>
                              <td className="border border-slate-300 px-2 py-1.5">{idxCounter++}</td>
                              <td className="border border-slate-300 px-2 py-1.5">{item.description}</td>
                              <td className="border border-slate-300 px-2 py-1.5 text-right font-mono tabular-nums">
                                {formatAngka(item.volume)}
                              </td>
                              <td className="border border-slate-300 px-2 py-1.5">{item.unit}</td>
                              <td className="border border-slate-300 px-2 py-1.5 text-right font-mono tabular-nums">
                                {formatRupiah(item.unitPrice)}
                              </td>
                              <td className="border border-slate-300 px-2 py-1.5 text-right font-mono tabular-nums">
                                {formatRupiah(item.totalPrice)}
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-slate-50 font-semibold">
                            <td colSpan={5} className="border border-slate-300 px-2 py-1.5 text-right">
                              Subtotal {grp.groupName}
                            </td>
                            <td className="border border-slate-300 px-2 py-1.5 text-right font-mono tabular-nums">
                              {formatRupiah(grp.subtotal)}
                            </td>
                          </tr>
                        </Fragment>
                      ));
                    })()}
                    <tr className="bg-emerald-50 font-bold text-[#0F3D2E]">
                      <td colSpan={5} className="border border-slate-300 px-2 py-2 text-right">
                        TOTAL ANGGARAN BIAYA
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-right font-mono tabular-nums">
                        {formatRupiah(budget.totalAmount)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 text-xs font-semibold italic text-slate-700">
                  Terbilang: {terbilangRupiah(budget.totalAmount)}.
                </p>
              </section>
            )}

            {/* Attachments */}
            {attachments.length > 0 && (
              <section className="mt-8">
                <h3 className="font-display text-sm font-bold text-[#0F3D2E]">
                  LAMPIRAN II: DOKUMENTASI & BERKAS PENDUKUNG
                </h3>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {attachments.map((att) => (
                    <div key={att.id} className="rounded border border-slate-200 p-3">
                      <p className="text-xs font-semibold text-[#111C18]">
                        {att.title} ({att.category})
                      </p>
                      {att.description && (
                        <p className="mt-0.5 text-[11px] text-slate-500">{att.description}</p>
                      )}
                      {att.isImage && isSafeImageUrl(att.fileUrl) ? (
                        <img
                          src={att.fileUrl}
                          alt={att.title}
                          className="mt-2 h-40 w-full rounded object-cover"
                        />
                      ) : (
                        <p className="mt-2 text-[11px] italic text-slate-500">
                          Berkas PDF: {att.fileName}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Tanda Tangan */}
            <div className="mt-10 flex justify-end text-xs">
              <div className="w-64 text-right">
                <p>
                  {appSettings.letterCity || institution?.kabupaten || 'Tempat'},{' '}
                  {formatTanggalLengkapIndonesia(proposal.proposalDate || new Date())}
                </p>
                <p className="mt-1 font-semibold">
                  Pimpinan {institution?.name?.trim() || 'Lembaga'},
                </p>
                <div className="h-16" />
                <p className="font-bold underline">
                  {institution?.leaderName?.trim() || '( ........................................ )'}
                </p>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
