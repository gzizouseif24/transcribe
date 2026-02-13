
import React, { useCallback, useState } from 'react';

interface FileUploaderProps {
  onFilesSelected: (files: File[]) => void;
  onUrlsSelected: (urls: string[]) => void;
  disabled?: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onFilesSelected, onUrlsSelected, disabled }) => {
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [urlInput, setUrlInput] = useState('');

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (disabled || mode === 'url') return;
      
      const files = Array.from(e.dataTransfer.files).filter((file: File) =>
        file.type.startsWith('audio/') || file.name.endsWith('.json')
      );
      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [disabled, mode, onFilesSelected]
  );

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).filter((file: File) =>
        file.type.startsWith('audio/') || file.name.endsWith('.json')
      );
      onFilesSelected(files);
    }
  };

  const handleUrlSubmit = () => {
    const urls = urlInput.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
    if (urls.length > 0) {
      onUrlsSelected(urls);
      setUrlInput('');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit mx-auto border border-slate-200 dark:border-slate-700">
        <button 
          onClick={() => setMode('file')}
          className={`px-4 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${mode === 'file' ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <i className="fa-solid fa-file-audio mr-2"></i> Local Files
        </button>
        <button 
          onClick={() => setMode('url')}
          className={`px-4 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${mode === 'url' ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <i className="fa-solid fa-link mr-2"></i> From Sheets (URLs)
        </button>
      </div>

      {mode === 'file' ? (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className={`relative group border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 
            ${disabled 
              ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 cursor-not-allowed' 
              : 'border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 cursor-pointer'
            }
          `}
        >
          <input
            type="file"
            multiple
            accept="audio/*,.json"
            onChange={handleFileInput}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            disabled={disabled}
          />
          <div className="flex flex-col items-center justify-center space-y-3 pointer-events-none">
            <div className={`p-4 rounded-full ${disabled ? 'bg-slate-100 dark:bg-slate-700 text-slate-300 dark:text-slate-500' : 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-200 dark:group-hover:bg-indigo-900 transition-colors'}`}>
              <i className="fa-solid fa-cloud-arrow-up text-2xl"></i>
            </div>
            <div className="text-slate-600 dark:text-slate-300">
              <p className="font-medium text-[11px] uppercase tracking-wider">Drag & Drop Files</p>
              <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-1 uppercase">WAV, MP3, and JSON matches</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 border-2 border-indigo-100 dark:border-indigo-900/30 rounded-xl p-4 space-y-3">
          <textarea
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste audio URLs from Google Sheets (One per line)..."
            className="w-full h-24 p-3 text-[10px] font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
          />
          <button 
            onClick={handleUrlSubmit}
            disabled={!urlInput.trim() || disabled}
            className="w-full py-2 bg-indigo-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 transition-all"
          >
            Import {urlInput.split('\n').filter(l => l.trim().startsWith('http')).length} Audio Links
          </button>
        </div>
      )}
    </div>
  );
};
