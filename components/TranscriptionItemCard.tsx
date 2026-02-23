import React, { useState, useRef, useEffect } from 'react';
import { TranscriptionItem, ProcessingStatus, ValidationError } from '../types';

interface TranscriptionItemCardProps {
  item: TranscriptionItem;
  onRemove: (id: string) => void;
  onUpdateJsonInput: (id: string, json: string) => void;
  onAudit: (id: string) => void;
  onTranscribe: (id: string) => void;
  onUpdateDraftText: (id: string, text: string) => void;
  onUpdateJsonOutput: (id: string, json: string) => void;
  onModelChange: (id: string, model: string) => void;
  onRetry: (id: string) => void;
  onApplyFixes: (id: string, activeErrors: ValidationError[]) => void;
  onDismissError: (id: string, index: number) => void;
  onAddCustomError: (id: string, error: ValidationError) => void;
  onPushToSheet: (id: string, accepted: 'Yes' | 'No') => Promise<'success' | 'error'>;
  canPush: boolean;
}

export const TranscriptionItemCard: React.FC<TranscriptionItemCardProps> = ({ 
  item, onRemove, onUpdateJsonInput, onAudit, onTranscribe,
  onUpdateDraftText, onUpdateJsonOutput, onModelChange, onRetry,
  onApplyFixes, onDismissError, onAddCustomError,
  onPushToSheet, canPush
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [pushStatus, setPushStatus] = useState<'idle' | 'pushing' | 'success' | 'error'>('idle');
  const [isScriptExpanded, setIsScriptExpanded] = useState(false);
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

  const handlePush = async (accepted: 'Yes' | 'No') => {
    setPushStatus('pushing');
    const result = await onPushToSheet(item.id, accepted);
    setPushStatus(result);
    if (result === 'success') {
      setTimeout(() => setPushStatus('idle'), 3000);
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
      case 'CUSTOM': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
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
          <div>
            <h3 className="text-[11px] font-black uppercase tracking-tight text-slate-800 dark:text-slate-100">{item.fileName}</h3>
            {item.rowNumber && (
              <span className="text-[8px] text-slate-400 font-mono">Row {item.rowNumber}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select value={item.model} onChange={(e) => onModelChange(item.id, e.target.value)} disabled={isBusy} className="text-[8px] font-black bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 px-2 py-1 rounded-md outline-none uppercase transition-all">
              <option value="gemini-3-flash-preview">Flash</option>
              <option value="gemini-3-pro-preview">Pro</option>
          </select>
          <button onClick={() => onRemove(item.id)} className="text-slate-400 hover:text-rose-500 transition-all"><i className="fa-solid fa-times"></i></button>
        </div>
      </div>

      <audio ref={audioRef} src={item.previewUrl || undefined} onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)} onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)} className="hidden" />

      <div className="p-4 space-y-6">
        {item.validationReport?.requiresManualReview && (
          <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-3 animate-pulse">
            <i className="fa-solid fa-triangle-exclamation text-amber-500 mt-0.5"></i>
            <div className="flex-1">
              <p className="text-[10px] text-amber-700 dark:text-amber-400 font-black uppercase tracking-wider">Complex Audio: Manual Review Highly Recommended</p>
              <p className="text-[9px] text-amber-600 dark:text-amber-500 mt-0.5">This audio has many errors or complex speaker turns. Please review the final JSON carefully.</p>
            </div>
          </div>
        )}

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
                   
                   <div className="mt-3 flex gap-2">
                     <input 
                       type="text" 
                       value={customPrompt}
                       onChange={(e) => setCustomPrompt(e.target.value)}
                       placeholder="Add custom instruction (e.g., 'Fix speaker 2 at 01:15')"
                       className="flex-1 px-3 py-2 text-[9px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                     />
                     <button 
                       onClick={() => {
                         if (customPrompt.trim()) {
                           onAddCustomError(item.id, {
                             tag: 'CUSTOM',
                             time: 'Global',
                             description: customPrompt.trim(),
                             severity: 'WARNING'
                           });
                           setCustomPrompt('');
                         }
                       }}
                       disabled={!customPrompt.trim()}
                       className="px-3 py-2 bg-slate-800 text-white rounded-lg text-[9px] font-black uppercase hover:bg-slate-700 transition-all disabled:opacity-50"
                     >
                       Add
                     </button>
                   </div>
                </div>
              )}

              {item.error && (
                <div className="px-4 py-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl">
                  <p className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">
                    <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>
                    {item.error}
                  </p>
                </div>
              )}

              <button onClick={() => onAudit(item.id)} disabled={isBusy || !item.inputJson.trim()} className="w-full py-3 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg disabled:opacity-50">
                 Run Acoustic Scan
              </button>
           </div>

           {/* STEP 2: REPAIR */}
           <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <button onClick={() => setIsScriptExpanded(!isScriptExpanded)} className="flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-300 transition-colors">
                  <i className={`fa-solid fa-chevron-${isScriptExpanded ? 'down' : 'right'}`}></i>
                  Master Script (Correction source)
                </button>
                <button onClick={() => { setIsScriptExpanded(true); onTranscribe(item.id); }} disabled={isBusy} className="text-[9px] font-black text-indigo-600 uppercase hover:underline flex items-center gap-1.5">
                   <i className={`fa-solid fa-wand-magic-sparkles ${item.status === ProcessingStatus.TRANSCRIBING ? 'fa-spin' : ''}`}></i>
                   Generate Draft Script
                </button>
              </div>

              {isScriptExpanded && (
                <div className="relative animate-in fade-in slide-in-from-top-2">
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
              )}

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

              {/* COMPLETED: copy + push to sheet */}
              {item.status === ProcessingStatus.COMPLETED && (
                 <div className="mt-4 p-4 bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl animate-in fade-in slide-in-from-bottom-2 space-y-3">
                    <div className="flex justify-between items-center">
                       <span className="text-[9px] font-black text-emerald-500 uppercase">REPAIRED JSON READY</span>
                       <button onClick={() => { navigator.clipboard.writeText(item.jsonOutput || ''); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} className={`text-[8px] font-black px-3 py-1 rounded-md transition-all ${isCopied ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
                          {isCopied ? 'Copied' : 'Copy Result'}
                       </button>
                    </div>
                    <textarea 
                       value={item.jsonOutput || ''}
                       onChange={(e) => onUpdateJsonOutput(item.id, e.target.value)}
                       className="w-full h-64 text-[10px] font-mono text-indigo-400/80 bg-black/40 p-3 rounded-xl scrollbar-hide border border-slate-800 focus:ring-1 focus:ring-emerald-500 outline-none resize-y"
                    />

                    {/* PUSH TO SHEET */}
                    {canPush && (
                      <div className="pt-2 border-t border-slate-800 space-y-2">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest text-center">Push to Sheet</p>
                        
                        {pushStatus === 'success' && (
                          <div className="px-3 py-2 bg-emerald-900/30 border border-emerald-700 rounded-xl text-center">
                            <p className="text-[9px] text-emerald-400 font-black uppercase">
                              <i className="fa-solid fa-circle-check mr-1.5"></i>Pushed! Row {item.rowNumber} updated
                            </p>
                          </div>
                        )}

                        {pushStatus === 'error' && (
                          <div className="px-3 py-2 bg-rose-900/30 border border-rose-700 rounded-xl text-center">
                            <p className="text-[9px] text-rose-400 font-black uppercase">
                              <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>Push failed — check console
                            </p>
                          </div>
                        )}

                        {pushStatus !== 'success' && (
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => handlePush('Yes')}
                              disabled={pushStatus === 'pushing'}
                              className="py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[9px] font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-900/30"
                            >
                              {pushStatus === 'pushing' ? (
                                <i className="fa-solid fa-spinner fa-spin"></i>
                              ) : (
                                <><i className="fa-solid fa-check"></i> Accept</>
                              )}
                            </button>
                            <button
                              onClick={() => handlePush('No')}
                              disabled={pushStatus === 'pushing'}
                              className="py-2.5 bg-rose-700 hover:bg-rose-600 text-white rounded-xl text-[9px] font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                              {pushStatus === 'pushing' ? (
                                <i className="fa-solid fa-spinner fa-spin"></i>
                              ) : (
                                <><i className="fa-solid fa-xmark"></i> Reject</>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                 </div>
              )}

              {/* PASS WITHOUT FIX: push original JSON as accepted */}
              {item.status === ProcessingStatus.READY_TO_FIX && item.validationReport?.isValid && canPush && (
                <div className="p-4 bg-emerald-900/20 border border-emerald-800 rounded-2xl space-y-3">
                  <p className="text-[9px] font-black text-emerald-400 uppercase tracking-wider text-center">
                    <i className="fa-solid fa-circle-check mr-1.5"></i>No errors — push original as accepted?
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handlePush('Yes')}
                      disabled={pushStatus === 'pushing'}
                      className="py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[9px] font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {pushStatus === 'pushing' ? <i className="fa-solid fa-spinner fa-spin"></i> : <><i className="fa-solid fa-check"></i> Accept</>}
                    </button>
                    <button
                      onClick={() => handlePush('No')}
                      disabled={pushStatus === 'pushing'}
                      className="py-2.5 bg-rose-700 hover:bg-rose-600 text-white rounded-xl text-[9px] font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {pushStatus === 'pushing' ? <i className="fa-solid fa-spinner fa-spin"></i> : <><i className="fa-solid fa-xmark"></i> Reject</>}
                    </button>
                  </div>
                  {pushStatus === 'success' && (
                    <p className="text-[9px] text-emerald-400 font-black uppercase text-center">
                      <i className="fa-solid fa-circle-check mr-1.5"></i>Row {item.rowNumber} updated!
                    </p>
                  )}
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};