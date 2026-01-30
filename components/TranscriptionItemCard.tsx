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

  const isProcessing = [ProcessingStatus.VALIDATING_JSON, ProcessingStatus.TRANSCRIBING, ProcessingStatus.ALIGNING].includes(item.status);

  const renderValidationUI = () => {
    if (item.status === ProcessingStatus.VALIDATING_JSON) {
      return (
        <div className="flex items-center text-indigo-600 dark:text-indigo-400 text-sm animate-pulse p-4 bg-indigo-50/30 dark:bg-indigo-900/10 rounded-lg">
           <i className="fa-solid fa-microchip fa-spin mr-3 text-lg"></i>
           Dual-Agent Validation in progress...
        </div>
      );
    }

    if (item.validationReport) {
      const { isValid, errors, warnings } = item.validationReport;
      return (
        <div className={`mt-4 p-4 rounded-xl border ${isValid ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200' : 'bg-red-50/50 dark:bg-red-900/10 border-red-200'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`font-bold flex items-center ${isValid ? 'text-emerald-700' : 'text-red-700'}`}>
               <i className={`fa-solid ${isValid ? 'fa-check-double' : 'fa-circle-xmark'} mr-2`}></i>
               {isValid ? "Clean Validation" : "Audit Errors Found"}
            </span>
            <div className="flex gap-2">
              <button onClick={() => onRetry(item.id)} className="text-xs px-2 py-1 bg-white dark:bg-slate-700 border border-slate-200 rounded hover:bg-slate-50">
                <i className="fa-solid fa-rotate-right mr-1"></i> Retry
              </button>
              {!isValid && (
                <button onClick={() => onSkipValidation(item.id)} className="text-xs px-2 py-1 bg-slate-800 text-white rounded hover:bg-slate-900">
                  Skip & Continue
                </button>
              )}
            </div>
          </div>
          {errors.length > 0 && (
            <ul className="text-xs space-y-1 mt-2 text-red-600 list-disc list-inside">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          {warnings && warnings.length > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
               <p className="text-[10px] font-bold text-slate-500 uppercase">Auditor Hallucination Filters:</p>
               <ul className="text-[10px] text-slate-500 italic list-none">
                 {warnings.map((w, i) => <li key={i}>{w}</li>)}
               </ul>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden hover:shadow-md transition-all">
      <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center space-x-3 overflow-hidden">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
            <i className="fa-solid fa-waveform"></i>
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 dark:text-slate-200 truncate">{item.fileName}</h3>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{item.model.replace('-preview', '')}</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <select
              value={item.model}
              onChange={(e) => onModelChange(item.id, e.target.value)}
              disabled={isProcessing}
              className="text-xs font-bold bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none"
          >
              <option value="gemini-3-flash-preview">FLASH (Fast)</option>
              <option value="gemini-3-pro-preview">PRO (Accurate)</option>
          </select>
          <button onClick={() => onRemove(item.id)} className="text-slate-400 hover:text-red-500 p-2 transition-colors">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      <audio ref={audioRef} src={item.previewUrl} onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)} onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)} className="hidden" />

      <div className="p-5 space-y-6">
        {/* Audio Bar */}
        <div className="flex items-center space-x-4 bg-slate-100 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
          <button onClick={togglePlay} className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center hover:scale-105 transition-transform">
             <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
          </button>
          <div className="flex-1 text-xs font-mono">
             <div className="flex justify-between mb-1 text-[10px] text-slate-500">
                <span>{Math.floor(currentTime/60)}:{(Math.floor(currentTime%60)).toString().padStart(2,'0')}</span>
                <span>{Math.floor(duration/60)}:{(Math.floor(duration%60)).toString().padStart(2,'0')}</span>
             </div>
             <input type="range" min="0" max={duration || 0} value={currentTime} onChange={(e) => {
               const t = parseFloat(e.target.value);
               setCurrentTime(t);
               if(audioRef.current) audioRef.current.currentTime = t;
             }} className="w-full h-1.5 bg-slate-300 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
          </div>
          <select value={playbackRate} onChange={(e) => setPlaybackRate(parseFloat(e.target.value))} className="text-[10px] font-bold bg-transparent border-none">
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => <option key={r} value={r}>{r}x</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
           <div className="space-y-3">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">1. Structural JSON</label>
              <textarea 
                value={item.inputJson}
                onChange={(e) => onUpdateJsonInput(item.id, e.target.value)}
                disabled={isProcessing || item.status !== ProcessingStatus.IDLE}
                placeholder='Paste timestamps here...'
                className="w-full h-44 p-4 text-[11px] font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none"
              />
              {renderValidationUI()}
              {item.status === ProcessingStatus.IDLE && (
                <button 
                  onClick={() => onValidate(item.id)}
                  disabled={!item.inputJson.trim()}
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 shadow-md shadow-indigo-200 dark:shadow-none transition-all"
                >
                  Start Multi-Agent QA
                </button>
              )}
           </div>

           <div className="space-y-3">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">2. Human-in-the-Loop Edit</label>
              {item.status === ProcessingStatus.READY_TO_TRANSCRIBE ? (
                <button onClick={() => onTranscribeDraft(item.id)} className="w-full h-44 flex flex-col items-center justify-center bg-indigo-50 dark:bg-indigo-900/10 border-2 border-dashed border-indigo-200 dark:border-indigo-800 rounded-xl hover:bg-indigo-100 transition-colors group">
                   <div className="w-12 h-12 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center mb-3 shadow-sm group-hover:scale-110 transition-transform">
                      <i className="fa-solid fa-wand-magic-sparkles text-indigo-600"></i>
                   </div>
                   <span className="text-indigo-900 dark:text-indigo-300 font-bold">Generate AI Draft</span>
                </button>
              ) : (item.status === ProcessingStatus.TRANSCRIBING || item.status === ProcessingStatus.TEXT_READY || item.status === ProcessingStatus.ALIGNING || item.status === ProcessingStatus.COMPLETED) ? (
                 <div className="space-y-3">
                    <textarea 
                        value={item.finalTranscription || ""}
                        onChange={(e) => onUpdateDraftText(item.id, e.target.value)}
                        disabled={item.status !== ProcessingStatus.TEXT_READY}
                        className="w-full h-44 p-4 text-sm arabic-text rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    />
                    {item.status === ProcessingStatus.TEXT_READY && (
                        <button onClick={() => onAlignJson(item.id)} className="w-full py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-200 dark:shadow-none">
                            Align to Final JSON
                        </button>
                    )}
                 </div>
              ) : (
                <div className="h-44 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 text-xs font-medium">
                   Waiting for Step 1...
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};