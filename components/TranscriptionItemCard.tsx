import React, { useState, useRef, useEffect } from 'react';
import { TranscriptionItem, ProcessingStatus } from '../types';

interface TranscriptionItemCardProps {
  item: TranscriptionItem;
  onRemove: (id: string) => void;
  onUpdateJsonInput: (id: string, json: string) => void;
  onValidate: (id: string) => void;
  onTranscribeDraft: (id: string) => void; // Generates Text
  onUpdateDraftText: (id: string, text: string) => void; // Updates Text
  onAlignJson: (id: string) => void; // Merges Text to JSON
}

export const TranscriptionItemCard: React.FC<TranscriptionItemCardProps> = ({ 
  item, 
  onRemove, 
  onUpdateJsonInput,
  onValidate,
  onTranscribeDraft,
  onUpdateDraftText,
  onAlignJson
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

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleCopyJson = () => {
    if (item.jsonOutput) {
        navigator.clipboard.writeText(item.jsonOutput);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "00:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const isProcessing = item.status === ProcessingStatus.VALIDATING_JSON || item.status === ProcessingStatus.TRANSCRIBING || item.status === ProcessingStatus.ALIGNING;
  
  const renderValidationStatus = () => {
    if (item.status === ProcessingStatus.VALIDATING_JSON) {
      return (
        <div className="flex items-center text-purple-600 dark:text-purple-400 text-sm animate-pulse">
           <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>
           Checking JSON vs Audio...
        </div>
      );
    }
    if (item.validationReport) {
      const { isValid, errors, warnings, stats } = item.validationReport;
      const validClass = isValid 
        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800' 
        : 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800';
      
      const textClass = isValid 
        ? 'text-emerald-700 dark:text-emerald-400' 
        : 'text-red-700 dark:text-red-400';

      return (
        <div className={`mt-3 p-3 rounded-lg border ${validClass}`}>
           <div className="flex items-center justify-between mb-2">
              <span className={`font-bold ${textClass}`}>
                 <i className={`fa-solid ${isValid ? 'fa-check-circle' : 'fa-times-circle'} mr-2`}></i>
                 {isValid ? "Validation Passed" : "Validation Failed"}
              </span>
           </div>
           {/* Errors/Warnings */}
           {errors.length > 0 && <ul className="text-xs text-red-600 dark:text-red-400 list-disc list-inside mb-1">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
           {warnings.length > 0 && <ul className="text-xs text-amber-600 dark:text-amber-400 list-disc list-inside">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden hover:shadow-md transition-all duration-200">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center space-x-3 overflow-hidden">
          <div className="w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <i className="fa-solid fa-file-audio"></i>
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-slate-800 dark:text-slate-200 truncate" title={item.fileName}>{item.fileName}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{new Date(item.addedAt).toLocaleTimeString()}</p>
          </div>
        </div>
        <button onClick={() => onRemove(item.id)} className="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 p-2 transition-colors">
          <i className="fa-solid fa-trash-can"></i>
        </button>
      </div>

      <audio ref={audioRef} src={item.previewUrl} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} className="hidden" />

      <div className="p-4 space-y-6">
        {/* Audio Controls */}
        <div className="flex items-center space-x-3 bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
          <button onClick={togglePlay} className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center transition-colors shrink-0">
             <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'} text-xs`}></i>
          </button>
          <input type="range" min="0" max={duration || 0} value={currentTime} onChange={(e) => {
            const t = parseFloat(e.target.value);
            setCurrentTime(t);
            if(audioRef.current) audioRef.current.currentTime = t;
          }} className="flex-1 h-1 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
          
          <div className="flex items-center space-x-2 shrink-0">
             <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 min-w-[60px] text-right">{formatTime(currentTime)} / {formatTime(duration)}</span>
             
             <div className="h-3 w-px bg-slate-300 dark:bg-slate-600 mx-1"></div>
             
             <select
                value={playbackRate}
                onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                className="bg-transparent text-[10px] font-mono font-medium text-slate-600 dark:text-slate-300 focus:outline-none cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 p-0 border-none ring-0"
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => (
                  <option key={rate} value={rate} className="bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                    {rate}x
                  </option>
                ))}
              </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
           {/* LEFT COLUMN: JSON INPUT */}
           <div className="space-y-3">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">1. Input JSON Skeleton</label>
              <textarea 
                value={item.inputJson}
                onChange={(e) => onUpdateJsonInput(item.id, e.target.value)}
                disabled={item.status !== ProcessingStatus.IDLE && item.status !== ProcessingStatus.READY_TO_TRANSCRIBE && item.status !== ProcessingStatus.ERROR}
                placeholder='Paste timestamps here...'
                className={`w-full h-40 p-3 text-xs font-mono rounded-lg border 
                  ${item.validationReport && !item.validationReport.isValid 
                    ? 'border-red-300 bg-red-50 dark:bg-red-900/10 dark:border-red-800 text-red-900 dark:text-red-200' 
                    : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100'} 
                  resize-none outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 disabled:opacity-60`}
              />
              {renderValidationStatus()}
              {(item.status === ProcessingStatus.IDLE || item.status === ProcessingStatus.ERROR) && (
                <button 
                  onClick={() => onValidate(item.id)}
                  disabled={!item.inputJson.trim() || isProcessing}
                  className="w-full py-2 bg-slate-800 dark:bg-slate-700 text-white rounded-lg text-sm font-medium hover:bg-slate-900 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors"
                >
                  Validate
                </button>
              )}
           </div>

           {/* RIGHT COLUMN: TRANSCRIPTION & EDITING */}
           <div className="space-y-3">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">2. Transcription & Edit</label>
              
              {item.status === ProcessingStatus.READY_TO_TRANSCRIBE ? (
                 <div className="h-40 flex flex-col items-center justify-center bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-dashed border-indigo-200 dark:border-indigo-800 text-center p-4">
                    <p className="text-indigo-900 dark:text-indigo-300 font-medium mb-2">Ready for Draft</p>
                    <button onClick={() => onTranscribeDraft(item.id)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 animate-bounce transition-colors">
                      Generate Draft Text
                    </button>
                 </div>
              ) : (item.status === ProcessingStatus.TRANSCRIBING || item.status === ProcessingStatus.TEXT_READY || item.status === ProcessingStatus.ALIGNING || item.status === ProcessingStatus.COMPLETED) ? (
                 <div className="flex flex-col h-full space-y-2">
                    {/* EDITABLE TEXTAREA */}
                    <textarea 
                        value={item.finalTranscription || ""}
                        onChange={(e) => onUpdateDraftText(item.id, e.target.value)}
                        disabled={item.status !== ProcessingStatus.TEXT_READY}
                        placeholder="Transcription will appear here..."
                        className={`w-full h-40 p-3 text-sm arabic-text rounded-lg border ${
                            item.status === ProcessingStatus.TEXT_READY 
                            ? 'border-indigo-300 bg-white dark:bg-slate-900 ring-2 ring-indigo-100 dark:ring-indigo-900/50 text-slate-900 dark:text-slate-100' 
                            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                        } resize-y focus:outline-none`}
                    />
                    
                    {/* ACTION BUTTONS */}
                    {item.status === ProcessingStatus.TEXT_READY && (
                        <button onClick={() => onAlignJson(item.id)} className="w-full py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 shadow-sm transition-colors">
                            <i className="fa-solid fa-file-export mr-2"></i>
                            Align Edited Text to JSON
                        </button>
                    )}
                    {item.status === ProcessingStatus.ALIGNING && (
                        <div className="text-center text-xs text-emerald-600 dark:text-emerald-400 animate-pulse">Aligning text to segments...</div>
                    )}
                    {item.status === ProcessingStatus.COMPLETED && (
                        <div className="flex space-x-2">
                             <button onClick={handleCopyJson} className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                                {isCopied ? "Copied JSON!" : "Copy Final JSON"}
                             </button>
                        </div>
                    )}
                 </div>
              ) : (
                 <div className="h-40 flex items-center justify-center bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-slate-400 text-xs">
                    Complete Step 1 to unlock
                 </div>
              )}
           </div>
        </div>

        {item.error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg border border-red-100 dark:border-red-800">
                <i className="fa-solid fa-triangle-exclamation mr-2"></i>{item.error}
            </div>
        )}
      </div>
    </div>
  );
};