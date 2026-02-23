
import React, { useState, useEffect } from 'react';
import { FileUploader } from './components/FileUploader';
import { TranscriptionItemCard } from './components/TranscriptionItemCard';
import { TranscriptionItem, ProcessingStatus, ValidationError } from './types';
import { 
  blobToBase64, 
  runAcousticAudit, 
  generateVerbatimScript, 
  applyUnifiedFixes
} from './services/gemini';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const generateId = () => Math.random().toString(36).substr(2, 9);

const App: React.FC = () => {
  const [items, setItems] = useState<TranscriptionItem[]>([]);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    const checkKey = async () => {
      const hasKey = window.aistudio ? await window.aistudio.hasSelectedApiKey() : true;
      setHasApiKey(hasKey);
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const handleApiError = (e: any) => {
    if (e.message && e.message.includes("Requested entity was not found")) {
      setHasApiKey(false);
      if (window.aistudio) window.aistudio.openSelectKey();
    }
  };

  const handleAudit = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item || !item.inputJson) return;
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.AUDITING } : i));
    try {
      const base64Audio = await blobToBase64(item.file);
      const report = await runAcousticAudit(base64Audio, item.mimeType, item.inputJson, item.model);
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.READY_TO_FIX, validationReport: report } : i));
    } catch (e: any) {
      handleApiError(e);
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ERROR, error: e.message } : i));
    }
  };

  const handleTranscribe = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.TRANSCRIBING } : i));
    try {
      const base64Audio = await blobToBase64(item.file);
      const text = await generateVerbatimScript(base64Audio, item.mimeType, item.model, (t) => {
          setItems(prev => prev.map(i => i.id === id ? { ...i, finalTranscription: t } : i));
      });
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.TEXT_READY, finalTranscription: text } : i));
    } catch (e: any) {
      handleApiError(e);
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ERROR, error: e.message } : i));
    }
  };

  const handleDismissError = (id: string, index: number) => {
    setItems(prev => prev.map(item => {
      if (item.id === id && item.validationReport) {
        const newErrors = item.validationReport.errors.filter((_, i) => i !== index);
        return {
          ...item,
          validationReport: {
            ...item.validationReport,
            errors: newErrors,
            isValid: newErrors.length === 0
          }
        };
      }
      return item;
    }));
  };

  const handleApplyFixes = async (id: string, activeErrors: ValidationError[]) => {
    const item = items.find(i => i.id === id);
    if (!item) return;

    setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.REPAIRING_JSON } : i));
    try {
      const base64Audio = await blobToBase64(item.file);
      const repaired = await applyUnifiedFixes(
        base64Audio, 
        item.mimeType, 
        item.inputJson, 
        activeErrors, 
        item.finalTranscription, 
        item.model
      );
      setItems(prev => prev.map(i => i.id === id ? { ...i, jsonOutput: repaired, status: ProcessingStatus.COMPLETED } : i));
    } catch (e: any) { handleApiError(e); }
  };

  const handleFilesSelected = async (files: File[]) => {
    const audioFiles = files.filter(f => f.type.startsWith('audio/'));
    const newItems = audioFiles.map(file => ({
      id: generateId(),
      file,
      fileName: file.name,
      mimeType: file.type || 'audio/mp3',
      previewUrl: URL.createObjectURL(file),
      status: ProcessingStatus.IDLE,
      inputJson: '',
      addedAt: Date.now(),
      model: 'gemini-3-flash-preview'
    }));
    setItems(prev => [...newItems, ...prev]);
  };

  const handleUrlsSelected = async (urls: string[]) => {
    for (const url of urls) {
      const tempId = generateId();
      setItems(prev => [{
        id: tempId,
        file: new Blob(),
        fileName: url.split('/').pop() || 'Remote Audio',
        mimeType: 'audio/mp3',
        previewUrl: '',
        status: ProcessingStatus.IDLE,
        inputJson: '',
        addedAt: Date.now(),
        model: 'gemini-3-flash-preview',
        error: 'Fetching audio...'
      }, ...prev]);
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        setItems(prev => prev.map(i => i.id === tempId ? { ...i, file: blob, previewUrl: URL.createObjectURL(blob), error: undefined } : i));
      } catch (err: any) {
        setItems(prev => prev.map(i => i.id === tempId ? { ...i, status: ProcessingStatus.ERROR, error: `CORS Blocked: ${err.message}` } : i));
      }
    }
  };

  if (!hasApiKey) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
      <div className="max-w-md text-center mb-8">
        <h2 className="text-white text-xl font-black uppercase tracking-widest mb-4">API Auth Required</h2>
        <button onClick={handleSelectKey} className="bg-indigo-600 text-white px-8 py-4 rounded-xl font-bold uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-2xl">Authorize Gemini</button>
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'} transition-all`}>
      <header className="h-14 border-b border-slate-200/50 dark:border-slate-800 flex items-center justify-between px-8 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
             <i className="fa-solid fa-microphone-lines text-white text-[14px]"></i>
          </div>
          <h1 className="text-[13px] font-black uppercase tracking-[0.4em]">Derja<span className="text-indigo-600">Scan</span></h1>
        </div>
        <button onClick={() => setDarkMode(!darkMode)} className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:text-indigo-500 transition-all">
          <i className={`fa-solid ${darkMode ? 'fa-sun' : 'fa-moon'} text-[14px]`}></i>
        </button>
      </header>

      <main className="max-w-5xl mx-auto p-8 space-y-10">
        <FileUploader onFilesSelected={handleFilesSelected} onUrlsSelected={handleUrlsSelected} />
        <section className="space-y-8 pb-20">
          {items.map(item => (
            <TranscriptionItemCard 
              key={item.id} item={item}
              onRemove={id => setItems(prev => prev.filter(i => i.id !== id))}
              onUpdateJsonInput={(id, json) => setItems(prev => prev.map(i => i.id === id ? { ...i, inputJson: json, status: ProcessingStatus.IDLE, validationReport: undefined } : i))}
              onAudit={handleAudit}
              onTranscribe={handleTranscribe}
              onUpdateDraftText={(id, t) => setItems(prev => prev.map(i => i.id === id ? { ...i, finalTranscription: t } : i))}
              onModelChange={(id, m) => setItems(prev => prev.map(i => i.id === id ? { ...i, model: m } : i))}
              onRetry={id => setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.IDLE, validationReport: undefined, error: undefined } : i))}
              onApplyFixes={handleApplyFixes}
              onDismissError={handleDismissError}
            />
          ))}
        </section>
      </main>
    </div>
  );
};

export default App;
