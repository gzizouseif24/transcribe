import React, { useState } from 'react';

interface ImportedRow {
  audioUrl: string;
  file: Blob;
  mimeType: string;
  json: string;
  fileName: string;
  audioError?: string;
}

interface SheetImporterProps {
  onImport: (rows: ImportedRow[]) => void;
  isLoading: boolean;
}

export const SheetImporter: React.FC<SheetImporterProps> = ({ onImport, isLoading }) => {
  const [scriptUrl, setScriptUrl] = useState('');
  const [startRow, setStartRow] = useState('');
  const [endRow, setEndRow] = useState('');
  const [status, setStatus] = useState<'idle' | 'fetching' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const handleImport = async () => {
    if (!scriptUrl.trim() || !startRow || !endRow) {
      setErrorMsg('Fill in all fields: Apps Script URL and row range.');
      setStatus('error');
      return;
    }

    const start = parseInt(startRow);
    const end = parseInt(endRow);

    if (isNaN(start) || isNaN(end) || start > end || start < 2) {
      setErrorMsg('Row range must be valid numbers (start ≥ 2, start ≤ end).');
      setStatus('error');
      return;
    }

    if (end - start + 1 > 10) {
      setErrorMsg('Max 10 rows at a time — audio fetching is heavy, keep it small.');
      setStatus('error');
      return;
    }

    setStatus('fetching');
    setErrorMsg('');

    try {
      const url = `${scriptUrl.trim()}?start=${start}&end=${end}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} — check your Apps Script deployment.`);

      const data = await res.json();
      console.log('Raw from Apps Script:', JSON.stringify(data.rows?.[0]).substring(0, 300));
      const rows: { audioBase64: string; mimeType: string; json: string; fileName: string }[] = data.rows || [];

      if (rows.length === 0) {
        throw new Error('No rows returned. Check the row range and Apps Script column indices.');
      }

      const imported: ImportedRow[] = rows
        .filter(r => r.audioBase64 || r.json)
        .map((r, i) => {
          let audioUrl = '';
          let file: Blob = new Blob();
          let audioError: string | undefined;

          if (r.audioBase64 && !r.audioBase64.startsWith('ERROR')) {
            try {
              const binary = atob(r.audioBase64.replace(/\s/g, ''));
              const bytes = new Uint8Array(binary.length);
              for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
              file = new Blob([bytes], { type: r.mimeType || 'audio/wav' });
              audioUrl = URL.createObjectURL(file);
            } catch (decodeErr: any) {
              console.error('Decode error:', decodeErr.message, 'base64 length:', r.audioBase64?.length);
              audioError = 'Failed to decode audio: ' + decodeErr.message;
            }
          } else if (r.audioBase64?.startsWith('ERROR')) {
            audioError = r.audioBase64;
          }

          return {
            audioUrl,
            file,
            mimeType: r.mimeType || 'audio/wav',
            json: r.json || '',
            fileName: r.fileName || `Row_${start + i}`,
            audioError
          };
        });

      if (imported.length === 0) {
        throw new Error('All rows were empty. Double-check column indices in your Apps Script.');
      }

      setStatus('done');
      onImport(imported);
    } catch (e: any) {
      setErrorMsg(e.message || 'Unknown error');
      setStatus('error');
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-lg">
            <i className="fa-solid fa-table-cells text-xs"></i>
          </div>
          <div className="text-left">
            <h3 className="text-[11px] font-black uppercase tracking-tight text-slate-800 dark:text-slate-100">
              Sheet Auto-Import
            </h3>
            <p className="text-[9px] text-slate-500 uppercase tracking-wider">Pull audio + JSON directly from your Google Sheet</p>
          </div>
        </div>
        <i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'} text-slate-400 text-xs`}></i>
      </button>

      {isExpanded && (
        <div className="p-5 space-y-4">
          {/* Info box */}
          <div className="px-4 py-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl space-y-1.5">
            <p className="text-[9px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
              <i className="fa-solid fa-circle-info mr-1.5"></i>How it works
            </p>
            <p className="text-[9px] text-slate-600 dark:text-slate-400 leading-relaxed">
              Apps Script fetches audio server-side (bypasses CORS), converts to base64, sends everything to this app in one shot. No downloads, no tab switching.
            </p>
          </div>

          {/* Apps Script URL */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Apps Script Web App URL</label>
            <input
              type="text"
              value={scriptUrl}
              onChange={(e) => setScriptUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="w-full px-4 py-2.5 text-[11px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-mono"
            />
          </div>

          {/* Row range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">From Row</label>
              <input
                type="number"
                value={startRow}
                onChange={(e) => setStartRow(e.target.value)}
                placeholder="2"
                min="2"
                className="w-full px-3 py-2.5 text-[11px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">To Row</label>
              <input
                type="number"
                value={endRow}
                onChange={(e) => setEndRow(e.target.value)}
                placeholder="7"
                min="2"
                className="w-full px-3 py-2.5 text-[11px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
              />
            </div>
          </div>

          <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-100 dark:border-amber-800">
            <p className="text-[9px] text-amber-600 dark:text-amber-400 uppercase tracking-wider">
              <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>
              Max 10 rows at a time — fetching audio takes ~5–15 seconds
            </p>
          </div>

          {/* Error */}
          {status === 'error' && (
            <div className="px-4 py-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl">
              <p className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">
                <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>
                {errorMsg}
              </p>
            </div>
          )}

          {/* Success */}
          {status === 'done' && (
            <div className="px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-black uppercase tracking-wider">
                <i className="fa-solid fa-circle-check mr-1.5"></i>
                Done! Audio + JSON loaded — scroll down to start scanning
              </p>
            </div>
          )}

          {/* Import Button */}
          <button
            onClick={handleImport}
            disabled={status === 'fetching' || isLoading}
            className="w-full py-3 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {status === 'fetching' ? (
              <>
                <i className="fa-solid fa-spinner fa-spin"></i>
                Fetching audio + JSON... (be patient)
              </>
            ) : (
              <>
                <i className="fa-solid fa-file-import"></i>
                Import Rows {startRow && endRow ? `(${startRow}–${endRow})` : ''}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};