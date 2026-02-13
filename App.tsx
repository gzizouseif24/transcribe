
import React, { useState, useEffect } from 'react';
import { FileUploader } from './components/FileUploader';
import { TranscriptionItemCard } from './components/TranscriptionItemCard';
import { TranscriptionItem, ProcessingStatus } from './types';
import { blobToBase64, validateJsonWithAudio, generateDraftTranscription, alignJsonToAudioAndText } from './services/gemini';

const generateId = () => Math.random().toString(36).substr(2, 9);

const TUNISIAN_GUIDELINES = `
القاعدة الذهبية: «اكتب ما تسمعه بالضبط، لا ما تعتقد أنه يجب أن يقال».
1. ممنوع منعا باتا استعمال علامات التنقيط (النقاط، الفواصل، علامات الاستفهام).
2. استعمال 'فما' دائما عوضا عن 'فمة'.
3. فصل المتحدثين: استعمل سطرا جديدا (Return) عند كل تغيير في المتحدث. هذا ضروري لضمان دقة التوقيت في الخطوة القادمة.
4. عدم تصحيح اللهجة إلى الفصحى: اكتب الكلمات كما تنطق (باش، شكون، علاش).
5. حرف الواو: لا توجد مسافة بعده (والله).
6. التاجات المسموحة: [english], [french], [music], [laughter], [unintelligible].
`;

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

  const handleApiError = (e: any) => {
    if (e.message && e.message.includes("Requested entity was not found")) {
      setHasApiKey(false);
      if (window.aistudio) {
        window.aistudio.openSelectKey();
      }
    }
  };

  const handleValidate = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item || !item.inputJson) return;
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.VALIDATING_JSON } : i));
    try {
      const base64Audio = await blobToBase64(item.file);
      const report = await validateJsonWithAudio(base64Audio, item.mimeType, item.inputJson, item.model);
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: report.isValid ? ProcessingStatus.READY_TO_TRANSCRIBE : ProcessingStatus.ERROR, validationReport: report } : i));
    } catch (e: any) {
      handleApiError(e);
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ERROR, error: e.message } : i));
    }
  };

  const handleTranscribeDraft = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.TRANSCRIBING } : i));
    try {
      const base64Audio = await blobToBase64(item.file);
      const text = await generateDraftTranscription(base64Audio, item.mimeType, TUNISIAN_GUIDELINES, item.model, (t) => {
          setItems(prev => prev.map(i => i.id === id ? { ...i, finalTranscription: t } : i));
      });
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.TEXT_READY, finalTranscription: text } : i));
    } catch (e: any) {
      handleApiError(e);
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ERROR, error: e.message } : i));
    }
  };

  const handleAlignJson = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item || !item.finalTranscription) return;
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ALIGNING } : i));
    try {
      const base64Audio = await blobToBase64(item.file);
      const finalJson = await alignJsonToAudioAndText(base64Audio, item.mimeType, item.finalTranscription!, item.inputJson, item.model);
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.COMPLETED, jsonOutput: finalJson } : i));
    } catch (e: any) {
      handleApiError(e);
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ERROR, error: e.message } : i));
    }
  };

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
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        const blob = await response.blob();
        setItems(prev => prev.map(i => i.id === tempId ? {
          ...i,
          file: blob,
          mimeType: blob.type || 'audio/mp3',
          previewUrl: URL.createObjectURL(blob),
          error: undefined
        } : i));
      } catch (err: any) {
        setItems(prev => prev.map(i => i.id === tempId ? {
          ...i,
          status: ProcessingStatus.ERROR,
          error: `CORS Blocked or URL invalid: ${err.message}`
        } : i));
      }
    }
  };

  if (!hasApiKey) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
      <div className="max-w-md text-center mb-8">
        <h2 className="text-white text-xl font-black uppercase tracking-widest mb-2">Gemini Pro API Required</h2>
        <p className="text-slate-400 text-sm">
          Please select a key from a <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline decoration-indigo-400/30">paid project</a> to process these complex audio tasks.
        </p>
      </div>
      <button onClick={handleSelectKey} className="bg-indigo-600 text-white px-8 py-4 rounded-xl font-bold uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-xl shadow-indigo-500/20">
        Activate AI Engine
      </button>
    </div>
  );

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'} transition-all`}>
      <header className="h-10 border-b border-slate-200/50 dark:border-slate-800 flex items-center justify-between px-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-indigo-600 rounded flex items-center justify-center">
             <i className="fa-solid fa-bolt-lightning text-white text-[10px]"></i>
          </div>
          <h1 className="text-[11px] font-black uppercase tracking-widest">Derja <span className="text-indigo-600">QA</span></h1>
        </div>
        <div className="flex items-center gap-4">
          {batchProgress && (
            <div className="flex items-center gap-2">
              <div className="w-16 h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-indigo-600 transition-all duration-300" 
                  style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                />
              </div>
              <span className="text-[8px] font-black uppercase text-indigo-600">{batchProgress.current}/{batchProgress.total}</span>
            </div>
          )}
          <button onClick={() => setDarkMode(!darkMode)} className="text-slate-500 hover:text-indigo-500 transition-colors">
            <i className={`fa-solid ${darkMode ? 'fa-sun' : 'fa-moon'} text-[12px]`}></i>
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => runSequential(items.filter(i => i.status === ProcessingStatus.IDLE && !i.error), handleValidate)} className="py-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-[9px] font-black uppercase tracking-widest hover:border-indigo-500 transition-all shadow-sm">Bulk QA Check</button>
          <button onClick={() => runSequential(items.filter(i => i.status === ProcessingStatus.READY_TO_TRANSCRIBE), handleTranscribeDraft)} className="py-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-[9px] font-black uppercase tracking-widest hover:border-indigo-500 transition-all shadow-sm">Bulk Draft Generation</button>
        </div>

        <section className="space-y-3">
           <FileUploader onFilesSelected={handleFilesSelected} onUrlsSelected={handleUrlsSelected} />
        </section>

        <section className="space-y-4 pb-10">
          {items.map(item => (
            <TranscriptionItemCard 
              key={item.id} item={item}
              onRemove={id => setItems(prev => prev.filter(i => i.id !== id))}
              onUpdateJsonInput={(id, json) => setItems(prev => prev.map(i => i.id === id ? { ...i, inputJson: json, status: ProcessingStatus.IDLE, validationReport: undefined } : i))}
              onValidate={handleValidate}
              onSkipValidation={id => setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.READY_TO_TRANSCRIBE } : i))}
              onTranscribeDraft={handleTranscribeDraft}
              onUpdateDraftText={(id, t) => setItems(prev => prev.map(i => i.id === id ? { ...i, finalTranscription: t } : i))}
              onAlignJson={handleAlignJson}
              onModelChange={(id, m) => setItems(prev => prev.map(i => i.id === id ? { ...i, model: m } : i))}
              onRetry={id => setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.IDLE, validationReport: undefined, error: undefined } : i))}
            />
          ))}
        </section>
      </main>
    </div>
  );
};

export default App;
