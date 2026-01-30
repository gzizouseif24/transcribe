import React, { useState, useEffect } from 'react';
import { FileUploader } from './components/FileUploader';
import { TranscriptionItemCard } from './components/TranscriptionItemCard';
import { TranscriptionItem, ProcessingStatus } from './types';
import { blobToBase64, validateJsonWithAudio, generateDraftTranscription, alignJsonToAudioAndText } from './services/gemini';

const generateId = () => Math.random().toString(36).substr(2, 9);
const DEFAULT_GUIDELINES = `STRICT VERBATIM: Tunisian Derja spelling. Use digits for numbers. Tags: [unintelligible], [music].`;

const App: React.FC = () => {
  const [items, setItems] = useState<TranscriptionItem[]>([]);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number} | null>(null);
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

  const handleValidate = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item || !item.inputJson) return;
    
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.VALIDATING_JSON, error: undefined } : i));
    try {
      const base64Audio = await blobToBase64(item.file);
      const report = await validateJsonWithAudio(base64Audio, item.mimeType, item.inputJson, item.model);
      setItems(prev => prev.map(i => i.id === id ? { 
        ...i, 
        status: report.isValid ? ProcessingStatus.READY_TO_TRANSCRIBE : ProcessingStatus.ERROR,
        validationReport: report
      } : i));
    } catch (e: any) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ERROR, error: e.message } : i));
    }
  };

  const handleTranscribeDraft = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.TRANSCRIBING } : i));
    try {
      const base64Audio = await blobToBase64(item.file);
      const text = await generateDraftTranscription(base64Audio, item.mimeType, DEFAULT_GUIDELINES, item.model, (t) => {
         setItems(prev => prev.map(i => i.id === id ? { ...i, finalTranscription: t } : i));
      });
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.TEXT_READY, finalTranscription: text } : i));
    } catch (e: any) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ERROR, error: e.message } : i));
    }
  };

  const handleAlignJson = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item || !item.finalTranscription) return;
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ALIGNING } : i));
    try {
      const base64Audio = await blobToBase64(item.file);
      const finalJson = await alignJsonToAudioAndText(base64Audio, item.mimeType, item.finalTranscription, item.inputJson, item.model);
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.COMPLETED, jsonOutput: finalJson } : i));
    } catch (e: any) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ERROR, error: e.message } : i));
    }
  };

  // --- BATCH RUNNERS (SEQUENTIAL FOR EFFICIENCY) ---
  const runSequential = async (targetItems: TranscriptionItem[], action: (id: string) => Promise<void>) => {
    setBatchProgress({ current: 0, total: targetItems.length });
    let count = 0;
    for (const item of targetItems) {
      await action(item.id);
      count++;
      setBatchProgress({ current: count, total: targetItems.length });
    }
    setTimeout(() => setBatchProgress(null), 2000);
  };

  const handleBatchValidate = () => {
    const targets = items.filter(i => (i.status === ProcessingStatus.IDLE || i.status === ProcessingStatus.ERROR) && i.inputJson);
    runSequential(targets, handleValidate);
  };

  const handleBatchDraft = () => {
    const targets = items.filter(i => i.status === ProcessingStatus.READY_TO_TRANSCRIBE);
    runSequential(targets, handleTranscribeDraft);
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

  if (!hasApiKey) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <button onClick={handleSelectKey} className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold shadow-xl">Activate API Key</button>
    </div>
  );

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'} transition-colors`}>
      <header className="h-20 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-8 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg"></div>
          <h1 className="text-lg font-black tracking-tight uppercase">Derja <span className="text-indigo-600">QA</span></h1>
        </div>
        <div className="flex items-center gap-4">
          {batchProgress && (
            <div className="text-[10px] font-black uppercase bg-indigo-600/10 text-indigo-600 px-3 py-1.5 rounded-full animate-pulse">
              Processing: {batchProgress.current} / {batchProgress.total}
            </div>
          )}
          <button onClick={() => setDarkMode(!darkMode)} className="p-3 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">
            <i className={`fa-solid ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-8 space-y-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button onClick={handleBatchValidate} className="p-4 bg-slate-100 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 hover:scale-[1.02] transition-transform text-center group">
            <div className="text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-widest">Step 1</div>
            <div className="font-black group-hover:text-indigo-600 transition-colors">Bulk Validate</div>
          </button>
          <button onClick={handleBatchDraft} className="p-4 bg-slate-100 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 hover:scale-[1.02] transition-transform text-center group">
            <div className="text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-widest">Step 2</div>
            <div className="font-black group-hover:text-indigo-600 transition-colors">Bulk AI Draft</div>
          </button>
          <div className="p-4 bg-slate-100 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-center">
            <div className="text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-widest">Ready</div>
            <div className="font-black">{items.filter(i=>i.status===ProcessingStatus.COMPLETED).length} Completed</div>
          </div>
        </div>

        <FileUploader onFilesSelected={handleFilesSelected} />

        <div className="space-y-6">
          {items.map(item => (
            <TranscriptionItemCard 
              key={item.id} item={item}
              onRemove={id => setItems(prev => prev.filter(i => i.id !== id))}
              onUpdateJsonInput={(id, json) => setItems(prev => prev.map(i => i.id === id ? { ...i, inputJson: json, status: ProcessingStatus.IDLE } : i))}
              onValidate={handleValidate}
              onSkipValidation={id => setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.READY_TO_TRANSCRIBE } : i))}
              onTranscribeDraft={handleTranscribeDraft}
              onUpdateDraftText={(id, t) => setItems(prev => prev.map(i => i.id === id ? { ...i, finalTranscription: t } : i))}
              onAlignJson={handleAlignJson}
              onModelChange={(id, m) => setItems(prev => prev.map(i => i.id === id ? { ...i, model: m } : i))}
              onRetry={id => setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.IDLE, validationReport: undefined } : i))}
            />
          ))}
        </div>
      </main>
    </div>
  );
};

export default App;