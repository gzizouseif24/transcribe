import React, { useState, useRef, useEffect } from 'react';
import { TranscriptionItem, ProcessingStatus } from '../types';

interface TranscriptionItemCardProps {
  item: TranscriptionItem;
  onRemove: (id: string) => void;
  onUpdateJsonInput: (id: string, json: string) => void;
  onValidate: (id: string) => void;
  onSkipValidation: (id: string) => void;
  onTranscribeDraft: (id: string) => void;
  onUpdateDraftText: (id: string, text: string) => void;
  onAlignJson: (id: string) => void;
  onModelChange: (id: string, model: string) => void;
  onRetry: (id: string) => void;
}

export const TranscriptionItemCard: React.FC<TranscriptionItemCardProps> = ({ 
  item, onRemove, onUpdateJsonInput, onValidate, onSkipValidation,
  onTranscribeDraft, onUpdateDraftText, onAlignJson, onModelChange, onRetry
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

  const handleCopy = () => {
    if (item.jsonOutput) {
      const textToCopy = typeof item.jsonOutput === 'string' 
        ? item.jsonOutput 
        : JSON.stringify(item.jsonOutput, null, 2);
      navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const isProcessing = [ProcessingStatus.VALIDATING_JSON, ProcessingStatus.TRANSCRIBING, ProcessingStatus.ALIGNING].includes(item.status);

  const renderValidationUI = () => {
    if (item.status === ProcessingStatus.VALIDATING_JSON) {
      return (
        <div className="flex items-center text-indigo-600 dark:text-indigo-400 text-xs animate-pulse p-4 bg-indigo-50/50 dark:bg-indigo-900/10 rounded-2xl border border-indigo-100 dark:border-indigo-800">
           <i className="fa-solid fa-brain-circuit fa-spin mr-3 text-lg"></i>
           Agents verifying acoustic integrity...
        </div>
      );
    }

    if (item.validationReport) {
      const { isValid, errors } = item.validationReport;
      return (
        <div className={`mt-4 p-4 rounded-2xl border ${isValid ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200' : 'bg-rose-50/50 dark:bg-rose-900/10 border-rose-200'}`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`font-black text-[10px] uppercase flex items-center ${isValid ? 'text-emerald-700' : 'text-rose-700'}`}>
               <i className={`fa-solid ${isValid ? 'fa-badge-check' : 'fa-circle-exclamation'} mr-2 text-sm`}></i>
               {isValid ? "Clean Code" : "Rejection Comments"}
            </span>
            <div className="flex gap-2">
              <button onClick={() => onRetry(item.id)} className="text-[9px] font-black px-2 py-1 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg shadow-sm">
                RETRY QA
              </button>
              {!isValid && (
                <button onClick={() => onSkipValidation(item.id)} className="text-[9px] font-black px-2 py-1 bg-slate-900 text-white rounded-lg shadow-sm">
                  FORCE PROCEED
                </button>
              )}
            </div>
          </div>
          {errors.length > 0 && (
            <ul className="text-xs space-y-1 mt-2 text-rose-700 list-disc list-inside arabic-text leading-relaxed">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden transition-all hover:shadow-xl hover:shadow-indigo-500/5">
      <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/30 dark:bg-slate-900/30">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-xl shadow-indigo-500/20">
            <i className="fa-solid fa-wave-square text-lg"></i>
          </div>
          <div className="min-w-0">
            <h3 className="font-black text-slate-800 dark:text-slate-100 truncate text-sm">{item.fileName}</h3>
            <div className="flex items-center gap-2 mt-0.5">
               <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-full uppercase">{item.model.split('-')[1]}</span>
               <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Tunisian Derja</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <select
              value={item.model}
              onChange={(e) => onModelChange(item.id, e.target.value)}
              disabled={isProcessing}
              className="text-[10px] font-black bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none uppercase"
          >
              <option value="gemini-3-flash-preview">Flash (Fast)</option>
              <option value="gemini-3-pro-preview">Pro (QA)</option>
          </select>
          <button onClick={() => onRemove(item.id)} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-rose-500 transition-all">
            <i className="fa-solid fa-circle-xmark text-xl"></i>
          </button>
        </div>
      </div>

      <audio ref={audioRef} src={item.previewUrl} onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)} onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)} className="hidden" />

      <div className="p-6 space-y-8">
        {/* Playback Control Bar */}
        <div className="flex items-center space-x-6 bg-slate-100/50 dark:bg-slate-900/50 p-4 rounded-3xl border border-slate-200/50 dark:border-slate-700/50">
          <button onClick={togglePlay} className="w-14 h-14 rounded-full bg-indigo-600 text-white flex items-center justify-center hover:scale-110 transition-all shadow-2xl shadow-indigo-600/40">
             <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'} text-xl`}></i>
          </button>
          <div className="flex-1 space-y-2">
             <div className="flex justify-between text-[10px] font-black font-mono text-slate-400 tracking-widest">
                <span>{Math.floor(currentTime/60)}:{(Math.floor(currentTime%60)).toString().padStart(2,'0')}</span>
                <span>{Math.floor(duration/60)}:{(Math.floor(duration%60)).toString().padStart(2,'0')}</span>
             </div>
             <input type="range" min="0" max={duration || 0} step="0.01" value={currentTime} onChange={(e) => {
               const t = parseFloat(e.target.value);
               setCurrentTime(t);
               if(audioRef.current) audioRef.current.currentTime = t;
             }} className="w-full h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full appearance-none cursor-pointer accent-indigo-600" />
          </div>
          <div className="flex flex-col items-center">
             <span className="text-[8px] font-black text-slate-400 uppercase mb-1">Speed</span>
             <select value={playbackRate} onChange={(e) => setPlaybackRate(parseFloat(e.target.value))} className="text-[10px] font-black bg-transparent border-none p-0 focus:ring-0">
               {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => <option key={r} value={r}>{r}x</option>)}
             </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
           {/* STEP 1: JSON SKELETON */}
           <div className="space-y-4">
              <div className="flex justify-between items-center px-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">1. JSON SKELETON (INPUT)</label>
                {item.status !== ProcessingStatus.IDLE && (
                   <span className="text-[9px] font-bold text-indigo-500 flex items-center animate-pulse">
                     <i className="fa-solid fa-lock mr-1.5"></i> Locked for QA
                   </span>
                )}
              </div>
              <div className="relative group">
                <textarea 
                  value={item.inputJson}
                  onChange={(e) => onUpdateJsonInput(item.id, e.target.value)}
                  disabled={isProcessing || item.status !== ProcessingStatus.IDLE}
                  placeholder="Paste JSON content here..."
                  className="w-full h-64 p-6 text-[11px] font-mono rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none leading-relaxed"
                />
              </div>
              {renderValidationUI()}
              {item.status === ProcessingStatus.IDLE && (
                <button 
                  onClick={() => onValidate(item.id)}
                  disabled={!item.inputJson.trim()}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.25em] hover:bg-indigo-700 shadow-xl shadow-indigo-600/20 active:scale-[0.98] transition-all"
                >
                  Start Dual-Agent QA
                </button>
              )}
           </div>

           {/* STEP 2: VERBATIM DRAFT */}
           <div className="space-y-4">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">2. VERBATIM DRAFT (PARAGRAPH)</label>
              
              {item.status === ProcessingStatus.READY_TO_TRANSCRIBE ? (
                <button onClick={() => onTranscribeDraft(item.id)} className="w-full h-64 flex flex-col items-center justify-center bg-indigo-50/50 dark:bg-indigo-900/10 border-2 border-dashed border-indigo-200 dark:border-indigo-800 rounded-[2rem] hover:bg-indigo-50 transition-all group">
                   <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform">
                      <i className="fa-solid fa-wand-magic-sparkles text-indigo-600 text-2xl"></i>
                   </div>
                   <span className="text-indigo-900 dark:text-indigo-300 font-black uppercase text-xs tracking-widest">Generate Verbatim Draft</span>
                   <p className="text-[9px] text-slate-400 mt-2 font-medium">Single Paragraph • No Timestamps</p>
                </button>
              ) : (item.status === ProcessingStatus.TRANSCRIBING || item.status === ProcessingStatus.TEXT_READY || item.status === ProcessingStatus.ALIGNING || item.status === ProcessingStatus.COMPLETED) ? (
                 <div className="space-y-5">
                    <textarea 
                        value={item.finalTranscription || ""}
                        onChange={(e) => onUpdateDraftText(item.id, e.target.value)}
                        disabled={item.status !== ProcessingStatus.TEXT_READY}
                        placeholder="Human review field..."
                        className="w-full h-64 p-7 text-sm arabic-text rounded-[2rem] border border-indigo-100 dark:border-indigo-800 bg-white dark:bg-slate-900 shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all leading-[2.5]"
                    />
                    
                    {item.status === ProcessingStatus.TEXT_READY && (
                        <button onClick={() => onAlignJson(item.id)} className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] hover:bg-emerald-700 shadow-xl shadow-emerald-600/20">
                            Apply Corrections to JSON
                        </button>
                    )}

                    {item.status === ProcessingStatus.COMPLETED && (
                        <div className="p-5 bg-slate-900 rounded-[2rem] border border-slate-700 shadow-2xl">
                             <div className="flex justify-between items-center mb-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Aligned JSON Output</span>
                                </div>
                                <button onClick={handleCopy} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase transition-all shadow-lg ${isCopied ? 'bg-emerald-600 text-white shadow-emerald-500/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                                   <i className={`fa-solid ${isCopied ? 'fa-check-circle' : 'fa-copy'} mr-2`}></i>
                                   {isCopied ? 'Code Copied' : 'Copy Full JSON'}
                                </button>
                             </div>
                             <div className="h-32 overflow-auto rounded-2xl bg-black/40 p-4 text-[10px] font-mono text-indigo-300/80 whitespace-pre scrollbar-hide border border-white/5">
                                {typeof item.jsonOutput === 'string' ? item.jsonOutput : JSON.stringify(item.jsonOutput, null, 2)}
                             </div>
                        </div>
                    )}
                 </div>
              ) : (
                <div className="h-64 bg-slate-50/50 dark:bg-slate-900/50 rounded-[2.5rem] border border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center space-y-3">
                   <i className="fa-solid fa-hourglass-half text-slate-300 text-2xl"></i>
                   <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Awaiting QA Step</span>
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};