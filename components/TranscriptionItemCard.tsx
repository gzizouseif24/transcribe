
import React, { useState, useRef, useEffect } from 'react';
import { TranscriptionItem, ProcessingStatus, ValidationError } from '../types';

interface TranscriptionItemCardProps {
  item: TranscriptionItem;
  onRemove: (id: string) => void;
  onUpdateJsonInput: (id: string, json: string) => void;
  onAudit: (id: string) => void;
  onTranscribe: (id: string) => void;
  onUpdateDraftText: (id: string, text: string) => void;
  onModelChange: (id: string, model: string) => void;
  onRetry: (id: string) => void;
  onApplyFixes: (id: string, activeErrors: ValidationError[]) => void;
  onDismissError: (id: string, index: number) => void;
}

export const TranscriptionItemCard: React.FC<TranscriptionItemCardProps> = ({ 
  item, onRemove, onUpdateJsonInput, onAudit, onTranscribe,
  onUpdateDraftText, onModelChange, onRetry,
  onApplyFixes, onDismissError
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  const togglePlay = () => {
    if (audioRef.current) {
      isPlaying ? audioRef.current.pause() : audioRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const seekTo = (timeStr: string) => {
    if (!audioRef.current) return;
    let seconds = 0;
    if (timeStr.includes(':')) {
      const parts = timeStr.split(':');
      seconds = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    } else {
      seconds = parseFloat(timeStr);
    }
    if (!isNaN(seconds)) {
      audioRef.current.currentTime = seconds;
      setCurrentTime(seconds);
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const isBusy = [
    ProcessingStatus.AUDITING, 
    ProcessingStatus.TRANSCRIBING, 
    ProcessingStatus.REPAIRING_JSON,
    ProcessingStatus.RECONSTRUCTING_JSON
  ].includes(item.status);

  const getTagStyle = (tag: string) => {
    switch (tag) {
      case 'SPEAKER': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300';
      case 'TIMING': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
      case 'CONTENT': return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
      case 'PUNCTUATION': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
      default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    }
  };

  const hasErrors = item.validationReport && item.validationReport.errors.length > 0;
  const activeErrors = item.validationReport?.errors || [];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden transition-all">
      <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <i className="fa-solid fa-microscope text-xs"></i>
          </div>
          <h3 className="text-[11px] font-black uppercase tracking-tight text-slate-800 dark:text-slate-100">{item.fileName}</h3>
        </div>
        <div className="flex items-center gap-3">
          <select value={item.model} onChange={(e) => onModelChange(item.id, e.target.value)} disabled={isBusy} className="text-[8px] font-black bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 px-2 py-1 rounded-md outline-none uppercase transition-all">
              <option value="gemini-3-flash-preview">Flash</option>
              <option value="gemini-3-pro-preview">Pro</option>
          </select>
          <button onClick={() => onRemove(item.id)} className="text-slate-400 hover:text-rose-500 transition-all"><i className="fa-solid fa-times"></i></button>
        </div>
      </div>

      <audio ref={audioRef} src={item.previewUrl} onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)} onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)} className="hidden" />

      <div className="p-4 space-y-6">
        <div className="flex items-center gap-4 bg-slate-100 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700">
          <button onClick={togglePlay} className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-lg hover:scale-105 transition-all">
             <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'} text-sm`}></i>
          </button>
          <div className="flex-1 space-y-1">
             <div className="flex justify-between text-[8px] font-black font-mono text-slate-500 uppercase">
                <span>{Math.floor(currentTime/60)}:{(Math.floor(currentTime%60)).toString().padStart(2,'0')}</span>
                <span>{Math.floor(duration/60)}:{(Math.floor(duration%60)).toString().padStart(2,'0')}</span>
             </div>
             <input type="range" min="0" max={duration || 0} step="0.01" value={currentTime} onChange={(e) => {
               const t = parseFloat(e.target.value);
               if(audioRef.current) audioRef.current.currentTime = t;
             }} className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full appearance-none cursor-pointer accent-indigo-600" />
          </div>
          <select value={playbackRate} onChange={(e) => setPlaybackRate(parseFloat(e.target.value))} className="text-[9px] font-black bg-transparent border-none focus:ring-0 cursor-pointer text-indigo-600">
             {[0.5, 1, 1.5, 2].map(r => <option key={r} value={r}>{r}x</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
           {/* STEP 1: AUDIT */}
           <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Acoustic Audit</label>
                {item.validationReport && (
                  <span className={`text-[8px] font-black px-2 py-0.5 rounded border ${item.validationReport.isValid && activeErrors.length === 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                    {item.validationReport.isValid && activeErrors.length === 0 ? 'READY' : `${activeErrors.length} PENDING`}
                  </span>
                )}
              </div>
              
              <div className="relative">
                <textarea 
                  value={item.inputJson}
                  onChange={(e) => onUpdateJsonInput(item.id, e.target.value)}
                  disabled={isBusy}
                  placeholder="Paste JSON segments here..."
                  className="w-full h-56 p-4 text-[10px] font-mono rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-indigo-500 outline-none resize-none transition-all shadow-inner"
                />
                {isBusy && (item.status === ProcessingStatus.AUDITING || item.status === ProcessingStatus.REPAIRING_JSON) && (
                  <div className="absolute inset-0 bg-white/60 dark:bg-slate-950/60 backdrop-blur-[2px] rounded-2xl flex items-center justify-center z-10">
                    <div className="flex flex-col items-center gap-2">
                       <i className="fa-solid fa-spinner fa-spin text-indigo-600 text-xl"></i>
                       <span className="text-[9px] font-black text-indigo-600 uppercase">AI Processing...</span>
                    </div>
                  </div>
                )}
              </div>

              {hasErrors && (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-hide">
                   <p className="text-[8px] font-black text-slate-400 uppercase ml-1">Detected Issues (X to dismiss):</p>
                   {activeErrors.map((err, i) => (
                      <div key={i} className="group p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 flex items-start gap-3 transition-all hover:border-indigo-200">
                         <span onClick={() => seekTo(err.time)} className={`cursor-pointer text-[7px] font-black px-1.5 py-0.5 rounded mt-0.5 whitespace-nowrap ${getTagStyle(err.tag)}`}>{err.tag}</span>
                         <div className="flex-1 cursor-pointer" onClick={() => seekTo(err.time)}>
                            <span className="text-[8px] font-mono text-slate-400 block mb-0.5">{err.time}</span>
                            <p className="text-[10px] font-medium leading-relaxed text-slate-700 dark:text-slate-300">{err.description}</p>
                         </div>
                         <button 
                           onClick={(e) => { e.stopPropagation(); onDismissError(item.id, i); }}
                           className="text-slate-300 hover:text-rose-500 transition-colors p-1"
                         >
                            <i className="fa-solid fa-xmark text-xs"></i>
                         </button>
                      </div>
                   ))}
                </div>
              )}

              <button onClick={() => onAudit(item.id)} disabled={isBusy || !item.inputJson.trim()} className="w-full py-3 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg disabled:opacity-50">
                 Run Acoustic Scan
              </button>
           </div>

           {/* STEP 2: REPAIR */}
           <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Master Script (Correction source)</label>
                <button onClick={() => onTranscribe(item.id)} disabled={isBusy} className="text-[9px] font-black text-indigo-600 uppercase hover:underline flex items-center gap-1.5">
                   <i className={`fa-solid fa-wand-magic-sparkles ${item.status === ProcessingStatus.TRANSCRIBING ? 'fa-spin' : ''}`}></i>
                   Generate Draft Script
                </button>
              </div>

              <div className="relative">
                <textarea 
                   value={item.finalTranscription || ""}
                   onChange={(e) => onUpdateDraftText(item.id, e.target.value)}
                   disabled={isBusy && item.status !== ProcessingStatus.TRANSCRIBING}
                   placeholder="Review or manually edit the script here..."
                   className="w-full h-56 p-5 text-[14px] arabic-text leading-[2] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-emerald-500 outline-none resize-none transition-all shadow-inner scrollbar-hide"
                />
                {item.status === ProcessingStatus.TRANSCRIBING && (
                  <div className="absolute inset-0 bg-emerald-500/5 dark:bg-emerald-500/10 backdrop-blur-[1px] flex items-center justify-center rounded-2xl z-10">
                     <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin"></div>
                  </div>
                )}
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4">
                 <div className="text-center">
                    <span className="text-[9px] font-black uppercase text-indigo-600 tracking-wider">Unified Repair</span>
                    <p className="text-[7px] text-slate-500 uppercase mt-0.5">Applies remaining fixes using curated data</p>
                 </div>
                 <button 
                   onClick={() => onApplyFixes(item.id, activeErrors)} 
                   disabled={isBusy || activeErrors.length === 0}
                   className="w-full py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] font-black uppercase hover:border-indigo-500 hover:text-indigo-600 transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
                 >
                   <i className="fa-solid fa-screwdriver-wrench mr-2"></i> Apply Remaining Fixes
                 </button>
              </div>

              {item.status === ProcessingStatus.COMPLETED && (
                 <div className="mt-4 p-4 bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex justify-between items-center mb-3">
                       <span className="text-[9px] font-black text-emerald-500 uppercase">REPAIRED JSON READY</span>
                       <button onClick={() => { navigator.clipboard.writeText(item.jsonOutput || ''); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} className={`text-[8px] font-black px-3 py-1 rounded-md transition-all ${isCopied ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
                          {isCopied ? 'Copied' : 'Copy Result'}
                       </button>
                    </div>
                    <div className="h-20 overflow-y-auto text-[9px] font-mono text-indigo-400/80 bg-black/40 p-3 rounded-xl scrollbar-hide select-all border border-slate-800">
                       {item.jsonOutput}
                    </div>
                 </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};
