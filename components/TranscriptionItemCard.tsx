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
        <div className="flex items-center text-purple-600 text-sm animate-pulse">
           <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>
           Checking JSON vs Audio...
        </div>
      );
    }
    if (item.validationReport) {
      const { isValid, errors, warnings, stats } = item.validationReport;
      return (
        <div className={`mt-3 p-3 rounded-lg border ${isValid ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
           <div className="flex items-center justify-between mb-2">
              <span className={`font-bold ${isValid ? 'text-emerald-700' : 'text-red-700'}`}>
                 <i className={`fa-solid ${isValid ? 'fa-check-circle' : 'fa-times-circle'} mr-2`}></i>
                 {isValid ? "Validation Passed" : "Validation Failed"}
              </span>
           </div>
           {/* Errors/Warnings */}
           {errors.length > 0 && <ul className="text-xs text-red-600 list-disc list-inside mb-1">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
           {warnings.length > 0 && <ul className="text-xs text-amber-600 list-disc list-inside">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center space-x-3 overflow-hidden">
          <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
            <i className="fa-solid fa-file-audio"></i>
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-slate-800 truncate" title={item.fileName}>{item.fileName}</h3>
            <p className="text-xs text-slate-500">{new Date(item.addedAt).toLocaleTimeString()}</p>
          </div>
        </div>
        <button onClick={() => onRemove(item.id)} className="text-slate-400 hover:text-red-500 p-2">
          <i className="fa-solid fa-trash-can"></i>
        </button>
      </div>

      <audio ref={audioRef} src={item.previewUrl} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} className="hidden" />

      <div className="p-4 space-y-6">
        {/* Audio Controls */}
        <div className="flex items-center space-x-3 bg-slate-50 p-2 rounded-lg border border-slate-100">
          <button onClick={togglePlay} className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700">
             <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'} text-xs`}></i>
          </button>
          <input type="range" min="0" max={duration || 0} value={currentTime} onChange={(e) => {
            const t = parseFloat(e.target.value);
            setCurrentTime(t);
            if(audioRef.current) audioRef.current.currentTime = t;
          }} className="flex-1 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
          <span className="text-[10px] font-mono text-slate-500">{formatTime(currentTime)} / {formatTime(duration)}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
           {/* LEFT COLUMN: JSON INPUT */}
           <div className="space-y-3">
              <label className="text-sm font-bold text-slate-700">1. Input JSON Skeleton</label>
              <textarea 
                value={item.inputJson}
                onChange={(e) => onUpdateJsonInput(item.id, e.target.value)}
                disabled={item.status !== ProcessingStatus.IDLE && item.status !== ProcessingStatus.READY_TO_TRANSCRIBE && item.status !== ProcessingStatus.ERROR}
                placeholder='Paste timestamps here...'
                className={`w-full h-40 p-3 text-xs font-mono rounded-lg border ${item.validationReport && !item.validationReport.isValid ? 'border-red-300 bg-red-50' : 'border-slate-300'} resize-none outline-none`}
              />
              {renderValidationStatus()}
              {(item.status === ProcessingStatus.IDLE || item.status === ProcessingStatus.ERROR) && (
                <button 
                  onClick={() => onValidate(item.id)}
                  disabled={!item.inputJson.trim() || isProcessing}
                  className="w-full py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-900 disabled:opacity-50"
                >
                  Validate
                </button>
              )}
           </div>

           {/* RIGHT COLUMN: TRANSCRIPTION & EDITING */}
           <div className="space-y-3">
              <label className="text-sm font-bold text-slate-700">2. Transcription & Edit</label>
              
              {item.status === ProcessingStatus.READY_TO_TRANSCRIBE ? (
                 <div className="h-40 flex flex-col items-center justify-center bg-indigo-50 rounded-lg border border-dashed border-indigo-200 text-center p-4">
                    <p className="text-indigo-900 font-medium mb-2">Ready for Draft</p>
                    <button onClick={() => onTranscribeDraft(item.id)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 animate-bounce">
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
                            ? 'border-indigo-300 bg-white ring-2 ring-indigo-100' 
                            : 'border-slate-200 bg-slate-50'
                        } resize-y focus:outline-none`}
                    />
                    
                    {/* ACTION BUTTONS */}
                    {item.status === ProcessingStatus.TEXT_READY && (
                        <button onClick={() => onAlignJson(item.id)} className="w-full py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 shadow-sm">
                            <i className="fa-solid fa-file-export mr-2"></i>
                            Align Edited Text to JSON
                        </button>
                    )}
                    {item.status === ProcessingStatus.ALIGNING && (
                        <div className="text-center text-xs text-emerald-600 animate-pulse">Aligning text to segments...</div>
                    )}
                    {item.status === ProcessingStatus.COMPLETED && (
                        <div className="flex space-x-2">
                             <button onClick={handleCopyJson} className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-200">
                                {isCopied ? "Copied JSON!" : "Copy Final JSON"}
                             </button>
                        </div>
                    )}
                 </div>
              ) : (
                 <div className="h-40 flex items-center justify-center bg-slate-50 rounded-lg border border-dashed border-slate-200 text-slate-400 text-xs">
                    Complete Step 1 to unlock
                 </div>
              )}
           </div>
        </div>

        {item.error && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                <i className="fa-solid fa-triangle-exclamation mr-2"></i>{item.error}
            </div>
        )}
      </div>
    </div>
  );
};