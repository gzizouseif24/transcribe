import React, { useCallback } from 'react';

interface FileUploaderProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onFilesSelected, disabled }) => {
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (disabled) return;
      
      const files = Array.from(e.dataTransfer.files).filter((file: File) =>
        file.type.startsWith('audio/') || file.name.endsWith('.json')
      );
      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [disabled, onFilesSelected]
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

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      className={`relative group border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 
        ${disabled 
          ? 'border-slate-200 bg-slate-50 cursor-not-allowed' 
          : 'border-indigo-300 bg-white hover:border-indigo-500 hover:bg-indigo-50/50 cursor-pointer'
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
        <div className={`p-4 rounded-full ${disabled ? 'bg-slate-100 text-slate-300' : 'bg-indigo-100 text-indigo-600 group-hover:bg-indigo-200 transition-colors'}`}>
          <i className="fa-solid fa-cloud-arrow-up text-2xl"></i>
        </div>
        <div className="text-slate-600">
          <p className="font-medium">Click to upload or drag & drop</p>
          <p className="text-sm text-slate-400 mt-1">Audio files (MP3/WAV) + Matching JSON files</p>
        </div>
      </div>
    </div>
  );
};