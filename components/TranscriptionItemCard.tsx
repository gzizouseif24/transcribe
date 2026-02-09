
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
        <div className="flex items-center text-indigo-600 text-[9px] font-black animate-pulse p-2 bg-indigo-50/50 dark:bg-indigo-900/10 rounded-lg border border-indigo-100 dark:border-indigo-900/30">
           <i className="fa-solid fa-microscope fa-spin mr-2"></i> AGENTS TRIANGULATING EVIDENCE...
        </div>
      );
    }

    if (item.validationReport && !item.validationReport.isValid && item.status === ProcessingStatus.ERROR) {
      const { errors } = item.validationReport;
      return (
        <div className="mt-2 space-y-1.5">
          <div className="flex justify-between items-center px-1">
            <span className="text-[8px] font-black uppercase text-rose-600">QA Rejection Logs</span>
            <div className="flex gap-1">
              <button onClick={() => onRetry(item.id)} className="text-[7px] font-black px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600">RETRY</button>
              <button onClick={() => onSkipValidation(item.id)} className="text-[7px] font-black px-1.5 py-0.5 bg-slate-900 text-white rounded">SKIP</button>
            </div>
          </div>
          <div className="space-y-1 max-h-32 overflow-auto scrollbar-hide">
            {errors.map((err, i) => (
              <div key={i} className="bg-rose-50/50 dark:bg-rose-950/20 p-2 rounded-lg border border-rose-100 dark:border-rose-900/50">
                <div className="flex justify-between items-center mb-0.5">
                  <span className="text-[8px] font-black text-rose-800 dark:text-rose-400 uppercase tracking-tight">{err.tag}</span>
                  <span className="text-[7px] font-mono text-slate-400 bg-white/50 dark:bg-black/20 px-1 rounded">{err.time}</span>
                </div>
                <p className="text-[10px] text-rose-900 dark:text-rose-100 leading-tight">{err.description}</p>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (item.validationReport?.isValid) {
      return (
        <div className="mt-2 p-2.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/50 rounded-xl shadow-sm ring-1 ring-emerald-500/10">
           <div className="flex items-center justify-between mb-2">
              <div className="flex items-center">
                <div className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center mr-2 shadow-sm">
                  <i className="fa-solid fa-check text-[10px]"></i>
                </div>
                <span className="text-[9px] font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">Acoustic Check: Clean</span>
              </div>
              <span className="text-[7px] font-bold text-emerald-600 dark:text-emerald-500 bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 rounded-full">READY</span>
           </div>
           <div className="grid grid-cols-2 gap-3 border-t border-emerald-100 dark:border-emerald-800/50 pt-2 text-[8px] font-black uppercase tracking-tighter">
              <div className="flex justify-between">
                 <span className="text-slate-400">Voices:</span>
                 <span className="text-emerald-600 dark:text-emerald-400">{item.validationReport.stats.audioSpeakerCount}</span>
              </div>
              <div className="flex justify-between">
                 <span className="text-slate-400">Integrity:</span>
                 <span className="text-emerald-600 dark:text-emerald-400">100%</span>
              </div>
           </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden transition-all hover:border-indigo-200 dark:hover:border-indigo-800">
      <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/30 dark:bg-slate-900/30">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center text-white shadow shadow-indigo-500/10">
            <i className="fa-solid fa-file-audio text-[10px]"></i>
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 truncate text-[11px] tracking-tight">{item.fileName}</h3>
        </div>
        <div className="flex items-center space-x-2">
          <select value={item.model} onChange={(e) => onModelChange(item.id, e.target.value)} disabled={isProcessing} className="text-[8px] font-black bg-white dark:bg-slate-700 border-none px-1 py-0.5 outline-none uppercase cursor-pointer hover:text-indigo-600 transition-colors">
              <option value="gemini-3-flash-preview">Flash</option>
              <option value="gemini-3-pro-preview">Pro</option>
          </select>
          <button onClick={() => onRemove(item.id)} className="text-slate-400 hover:text-rose-500 transition-colors"><i className="fa-solid fa-xmark text-sm"></i></button>
        </div>
      </div>

      <audio ref={audioRef} src={item.previewUrl} onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)} onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)} className="hidden" />

      <div className="p-3 space-y-3">
        <div className="flex items-center space-x-3 bg-slate-50 dark:bg-slate-900/50 p-2 rounded-xl border border-slate-200 dark:border-slate-700">
          <button onClick={togglePlay} className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/20 transition-all active:scale-90 hover:bg-indigo-700">
             <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'} text-[10px]`}></i>
          </button>
          <div className="flex-1">
             <div className="flex justify-between text-[7px] font-black font-mono text-slate-400 mb-0.5 tracking-tighter">
                <span>{Math.floor(currentTime/60)}:{(Math.floor(currentTime%60)).toString().padStart(2,'0')}</span>
                <span>{Math.floor(duration/60)}:{(Math.floor(duration%60)).toString().padStart(2,'0')}</span>
             </div>
             <input type="range" min="0" max={duration || 0} step="0.01" value={currentTime} onChange={(e) => {
               const t = parseFloat(e.target.value);
               setCurrentTime(t);
               if(audioRef.current) audioRef.current.currentTime = t;
             }} className="w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-full appearance-none cursor-pointer accent-indigo-600" />
          </div>
          <select value={playbackRate} onChange={(e) => setPlaybackRate(parseFloat(e.target.value))} className="text-[8px] font-black bg-transparent border-none p-0 focus:ring-0 cursor-pointer">
             {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => <option key={r} value={r}>{r}x</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
           <div className="space-y-2">
              <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest pl-1 block">Step 1: JSON Structure</label>
              <textarea 
                value={item.inputJson}
                onChange={(e) => onUpdateJsonInput(item.id, e.target.value)}
                disabled={isProcessing || item.status !== ProcessingStatus.IDLE}
                placeholder="Paste original JSON..."
                className="w-full h-32 p-3 text-[9px] font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-1 focus:ring-indigo-500 outline-none resize-none transition-shadow"
              />
              {renderValidationUI()}
              {item.status === ProcessingStatus.IDLE && (
                <button onClick={() => onValidate(item.id)} disabled={!item.inputJson.trim()} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-md shadow-indigo-500/10 disabled:opacity-50 disabled:cursor-not-allowed">Verify Acoustics</button>
              )}
           </div>

           <div className="space-y-2">
              <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest pl-1 block">Step 2: Verbatim Review</label>
              {item.status === ProcessingStatus.READY_TO_TRANSCRIBE ? (
                <button onClick={() => onTranscribeDraft(item.id)} className="w-full h-32 flex flex-col items-center justify-center bg-indigo-50/30 dark:bg-indigo-900/10 border-2 border-dashed border-indigo-200 dark:border-indigo-800/50 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all group">
                   <div className="w-10 h-10 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center mb-2 shadow-sm group-hover:scale-110 transition-transform"><i className="fa-solid fa-wand-magic-sparkles text-indigo-600 text-[12px]"></i></div>
                   <span className="text-indigo-900 dark:text-indigo-300 font-black uppercase text-[8px] tracking-widest">Generate Draft</span>
                </button>
              ) : (item.status === ProcessingStatus.TRANSCRIBING || item.status === ProcessingStatus.TEXT_READY || item.status === ProcessingStatus.ALIGNING || item.status === ProcessingStatus.COMPLETED) ? (
                 <div className="space-y-2">
                    <textarea 
                        value={item.finalTranscription || ""}
                        onChange={(e) => onUpdateDraftText(item.id, e.target.value)}
                        disabled={item.status !== ProcessingStatus.TEXT_READY}
                        placeholder="Review text content here..."
                        className="w-full h-32 p-3 text-[11px] arabic-text rounded-xl border border-indigo-100 dark:border-indigo-900/30 bg-white dark:bg-slate-900 focus:ring-1 focus:ring-emerald-500 outline-none leading-[2] text-slate-800 dark:text-slate-100"
                    />
                    {item.status === ProcessingStatus.TEXT_READY && (
                        <button onClick={() => onAlignJson(item.id)} className="w-full py-2.5 bg-emerald-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-md shadow-emerald-500/10">Apply to JSON</button>
                    )}
                    {item.status === ProcessingStatus.COMPLETED && (
                        <div className="p-2 bg-slate-900 rounded-xl border border-slate-700 shadow-inner">
                             <div className="flex justify-between items-center mb-1.5 px-1">
                                <span className="text-[7px] font-black text-slate-500 uppercase tracking-widest">Final Output</span>
                                <button onClick={handleCopy} className={`px-2 py-0.5 rounded text-[7px] font-black uppercase transition-all flex items-center gap-1.5 ${isCopied ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:text-white'}`}>
                                   <i className={`fa-solid ${isCopied ? 'fa-check' : 'fa-copy'}`}></i> {isCopied ? 'Copied' : 'Copy'}
                                </button>
                             </div>
                             <div className="h-12 overflow-auto rounded-lg bg-black/40 p-2 text-[9px] font-mono text-indigo-300/80 scrollbar-hide select-all">
                                {typeof item.jsonOutput === 'string' ? item.jsonOutput : JSON.stringify(item.jsonOutput, null, 2)}
                             </div>
                        </div>
                    )}
                 </div>
              ) : (
                <div className="h-32 bg-slate-50/50 dark:bg-slate-900/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center space-y-2">
                   <div className="relative">
                      <i className="fa-solid fa-hourglass-half text-slate-300 dark:text-slate-700 text-lg"></i>
                      <div className="absolute -top-1 -right-1 w-2 h-2 bg-slate-200 dark:bg-slate-700 rounded-full animate-ping"></div>
                   </div>
                   <span className="text-slate-400 dark:text-slate-600 text-[8px] font-black uppercase tracking-[0.2em]">Step 1 Pending</span>
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};
