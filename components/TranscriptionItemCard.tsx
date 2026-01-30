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
        <div className="flex items-center text-indigo-600 dark:text-indigo-400 text-sm animate-pulse p-4 bg-indigo-50/30 dark:bg-indigo-900/10 rounded-lg">
           <i className="fa-solid fa-robot-astray fa-spin mr-3 text-lg"></i>
           Dual-Agent QA: Checking Acoustic vs Structure...
        </div>
      );
    }

    if (item.validationReport) {
      const { isValid, errors, warnings } = item.validationReport;
      return (
        <div className={`mt-4 p-4 rounded-xl border ${isValid ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200' : 'bg-red-50/50 dark:bg-red-900/10 border-red-200'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`font-bold flex items-center ${isValid ? 'text-emerald-700' : 'text-red-700'}`}>
               <i className={`fa-solid ${isValid ? 'fa-circle-check' : 'fa-triangle-exclamation'} mr-2`}></i>
               {isValid ? "Validation Passed" : "Validation Failed"}
            </span>
            <div className="flex gap-2">
              <button onClick={() => onRetry(item.id)} className="text-[10px] font-bold px-2 py-1 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded uppercase">
                Retry
              </button>
              {!isValid && (
                <button onClick={() => onSkipValidation(item.id)} className="text-[10px] font-bold px-2 py-1 bg-slate-800 text-white rounded uppercase">
                  Skip Errors
                </button>
              )}
            </div>
          </div>
          {errors.length > 0 && (
            <ul className="text-xs space-y-1 mt-2 text-red-600 list-disc list-inside arabic-text">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          {warnings && warnings.length > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
               <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Auditor Filtered Claims:</p>
               <ul className="text-[9px] text-slate-400 italic">
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
    <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden transition-all">
      <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center space-x-3 overflow-hidden">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200 dark:shadow-none">
            <i className="fa-solid fa-microphone-lines"></i>
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 dark:text-slate-200 truncate">{item.fileName}</h3>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">{item.model.replace('-preview', '')}</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <select
              value={item.model}
              onChange={(e) => onModelChange(item.id, e.target.value)}
              disabled={isProcessing}
              className="text-xs font-bold bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none"
          >
              <option value="gemini-3-flash-preview">FLASH</option>
              <option value="gemini-3-pro-preview">PRO</option>
          </select>
          <button onClick={() => onRemove(item.id)} className="text-slate-400 hover:text-red-500 p-2 transition-transform hover:scale-110">
            <i className="fa-solid fa-circle-xmark"></i>
          </button>
        </div>
      </div>

      <audio ref={audioRef} src={item.previewUrl} onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)} onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)} className="hidden" />

      <div className="p-6 space-y-6">
        {/* Modern Audio Player Component */}
        <div className="flex items-center space-x-4 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
          <button onClick={togglePlay} className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center hover:scale-105 transition-all shadow-md">
             <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'} text-lg`}></i>
          </button>
          <div className="flex-1 space-y-1">
             <div className="flex justify-between text-[10px] font-mono text-slate-400">
                <span>{Math.floor(currentTime/60)}:{(Math.floor(currentTime%60)).toString().padStart(2,'0')}</span>
                <span>{Math.floor(duration/60)}:{(Math.floor(duration%60)).toString().padStart(2,'0')}</span>
             </div>
             <input type="range" min="0" max={duration || 0} value={currentTime} onChange={(e) => {
               const t = parseFloat(e.target.value);
               setCurrentTime(t);
               if(audioRef.current) audioRef.current.currentTime = t;
             }} className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full appearance-none cursor-pointer accent-indigo-600" />
          </div>
          <select value={playbackRate} onChange={(e) => setPlaybackRate(parseFloat(e.target.value))} className="text-[10px] font-black bg-transparent border-none focus:ring-0">
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => <option key={r} value={r}>{r}x</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
           {/* STEP 1: VALIDATION & INPUT */}
           <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Step 1: JSON Skeleton</label>
                {item.status === ProcessingStatus.COMPLETED && (
                  <span className="text-[10px] font-bold text-emerald-500 flex items-center">
                    <i className="fa-solid fa-check-circle mr-1"></i> Finalized
                  </span>
                )}
              </div>
              <textarea 
                value={item.inputJson}
                onChange={(e) => onUpdateJsonInput(item.id, e.target.value)}
                disabled={isProcessing || item.status !== ProcessingStatus.IDLE}
                placeholder="Paste original JSON with timestamps here..."
                className="w-full h-56 p-5 text-[11px] font-mono rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-inner focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none"
              />
              {renderValidationUI()}
              {item.status === ProcessingStatus.IDLE && (
                <button 
                  onClick={() => onValidate(item.id)}
                  disabled={!item.inputJson.trim()}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-100 dark:shadow-none transition-all"
                >
                  Verify Structural Integrity
                </button>
              )}
           </div>

           {/* STEP 2: EDITING & OUTPUT */}
           <div className="space-y-4">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Step 2: Paragraph Transcription</label>
              {item.status === ProcessingStatus.READY_TO_TRANSCRIBE ? (
                <button onClick={() => onTranscribeDraft(item.id)} className="w-full h-56 flex flex-col items-center justify-center bg-indigo-50/50 dark:bg-indigo-900/10 border-2 border-dashed border-indigo-200 dark:border-indigo-800 rounded-2xl hover:bg-indigo-50 transition-colors group">
                   <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center mb-4 shadow-sm group-hover:scale-110 transition-transform">
                      <i className="fa-solid fa-wand-sparkles text-indigo-600 text-xl"></i>
                   </div>
                   <span className="text-indigo-900 dark:text-indigo-300 font-black uppercase text-xs">Generate AI Draft</span>
                </button>
              ) : (item.status === ProcessingStatus.TRANSCRIBING || item.status === ProcessingStatus.TEXT_READY || item.status === ProcessingStatus.ALIGNING || item.status === ProcessingStatus.COMPLETED) ? (
                 <div className="space-y-4">
                    <textarea 
                        value={item.finalTranscription || ""}
                        onChange={(e) => onUpdateDraftText(item.id, e.target.value)}
                        disabled={item.status !== ProcessingStatus.TEXT_READY}
                        placeholder="AI Paragraph Draft..."
                        className="w-full h-56 p-6 text-sm arabic-text rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all leading-relaxed"
                    />
                    {item.status === ProcessingStatus.TEXT_READY && (
                        <button onClick={() => onAlignJson(item.id)} className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-emerald-700 shadow-lg shadow-emerald-100 dark:shadow-none">
                            Align Corrected Text to JSON
                        </button>
                    )}
                    {item.status === ProcessingStatus.COMPLETED && (
                        <div className="p-4 bg-slate-900 rounded-2xl border border-slate-700">
                             <div className="flex justify-between items-center mb-3">
                                <span className="text-[10px] font-black text-slate-500 uppercase">Final Output Code</span>
                                <button onClick={handleCopy} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${isCopied ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                                   <i className={`fa-solid ${isCopied ? 'fa-check' : 'fa-copy'} mr-2`}></i>
                                   {isCopied ? 'JSON Copied' : 'Copy Final JSON'}
                                </button>
                             </div>
                             <div className="h-24 overflow-auto rounded-lg bg-black/30 p-3 text-[9px] font-mono text-indigo-300 whitespace-pre scrollbar-hide">
                                {typeof item.jsonOutput === 'string' ? item.jsonOutput : JSON.stringify(item.jsonOutput, null, 2)}
                             </div>
                        </div>
                    )}
                 </div>
              ) : (
                <div className="h-56 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 text-[11px] font-bold uppercase tracking-widest">
                   Waiting for Validation...
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};