import { Link } from 'react-router-dom';
import { ArrowLeft, Layers } from 'lucide-react';

interface UpcomingModulePageProps {
  title: string;
  stage: string;
  description: string;
  plannedFeatures: string[];
}

export function UpcomingModulePage({
  title,
  stage,
  description,
  plannedFeatures,
}: UpcomingModulePageProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8">
      <div className="max-w-2xl">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#0F3D2E]/10 text-[#0F3D2E]">
          <Layers className="h-5 w-5" />
        </div>
        <p className="mt-5 text-xs font-semibold text-[#9A742B]">
          {stage} · Struktur Modul Terdaftar
        </p>
        <h2 className="mt-1.5 font-display text-2xl font-bold text-[#111C18]">
          {title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          {description}
        </p>

        <div className="mt-6 border-t border-slate-100 pt-5">
          <p className="text-xs font-semibold text-slate-700">
            Cakupan Fitur yang Disiapkan untuk {stage}:
          </p>
          <ul className="mt-3 space-y-2 text-sm text-slate-600 list-disc pl-5">
            {plannedFeatures.map((feat) => (
              <li key={feat}>{feat}</li>
            ))}
          </ul>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#144D3A]"
          >
            <ArrowLeft className="h-4 w-4" />
            Kembali ke Dashboard
          </Link>
          <Link
            to="/profil-lembaga"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Kelola Profil Lembaga
          </Link>
        </div>
      </div>
    </div>
  );
}
