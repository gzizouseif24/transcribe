import React, { useState, useEffect } from 'react';
import { FileUploader } from './components/FileUploader';
import { TranscriptionItemCard } from './components/TranscriptionItemCard';
import { TranscriptionItem, ProcessingStatus } from './types';
import { blobToBase64, validateJsonWithAudio, generateDraftTranscription, alignJsonToAudioAndText } from './services/gemini';

const generateId = () => Math.random().toString(36).substr(2, 9);

// Comprehensive Guidelines based on user prompt
const TUNISIAN_GUIDELINES = `
القاعدة الذهبية: «اكتب ما تسمعه بالضبط، لا ما تعتقد أنه يجب أن يقال».
1. الخطوات: مراجعة النص العربي فقط، الحفاظ على علامات الـ JSON ("transcription").
2. الممنوعات: حذف الأقواس {}، علامات التنصيص ""، أو الفواصل ,.
3. التاجات: [english], [french], [other_dialect], [music], [laughter], [unintelligible].
4. الفصحى: تُكتب كما هي تماماً بإملاء صحيح.
5. حرف الواو: لا توجد مسافة بعده (والله).
6. المسافات: لا مسافات زائدة في البداية أو النهاية.
7. التشكيل: ممنوع ما عدا تنوين الفتح (ً) مثل: طبعاً.
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
      const text = await generateDraftTranscription(base64Audio, item.mimeType, TUNISIAN_GUIDELINES, item.model, (t) => {
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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <button onClick={handleSelectKey} className="bg-indigo-600 text-white px-10 py-5 rounded-3xl font-black uppercase tracking-widest shadow-2xl shadow-indigo-600/40 hover:scale-105 active:scale-95 transition-all">Activate AI Engine</button>
    </div>
  );

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'} transition-all duration-500`}>
      <header className="h-24 border-b border-slate-200/50 dark:border-slate-800 flex items-center justify-between px-10 bg-white/40 dark:bg-slate-900/40 backdrop-blur-2xl sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-600/30 flex items-center justify-center">
             <i className="fa-solid fa-bolt-lightning text-white text-lg"></i>
          </div>
          <div>
            <h1 className="text-lg font-black tracking-[0.2em] uppercase leading-none">Derja <span className="text-indigo-600">QA</span></h1>
            <p className="text-[9px] font-black text-slate-400 uppercase mt-1 tracking-widest">Enterprise Transcription Tool</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          {batchProgress && (
            <div className="flex items-center gap-3 bg-indigo-600/10 px-4 py-2 rounded-2xl border border-indigo-600/20">
               <div className="w-2 h-2 bg-indigo-600 rounded-full animate-ping"></div>
               <span className="text-[10px] font-black uppercase text-indigo-600 tracking-widest">
                 Working: {batchProgress.current} / {batchProgress.total}
               </span>
            </div>
          )}
          <button onClick={() => setDarkMode(!darkMode)} className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center hover:scale-110 transition-all text-slate-500 dark:text-slate-400">
            <i className={`fa-solid ${darkMode ? 'fa-sun' : 'fa-moon'} text-lg`}></i>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-10 space-y-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <button onClick={handleBatchValidate} className="p-8 bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 hover:border-indigo-500/50 transition-all group relative overflow-hidden">
            <div className="relative z-10 text-center">
              <div className="text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest group-hover:text-indigo-500 transition-colors">Phase 01</div>
              <div className="text-xl font-black group-hover:scale-105 transition-transform">Bulk QA Validate</div>
            </div>
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
               <i className="fa-solid fa-shield-halved text-5xl"></i>
            </div>
          </button>
          
          <button onClick={handleBatchDraft} className="p-8 bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 hover:border-indigo-500/50 transition-all group relative overflow-hidden">
            <div className="relative z-10 text-center">
              <div className="text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest group-hover:text-indigo-500 transition-colors">Phase 02</div>
              <div className="text-xl font-black group-hover:scale-105 transition-transform">Bulk AI Draft</div>
            </div>
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
               <i className="fa-solid fa-wand-sparkles text-5xl"></i>
            </div>
          </button>

          <div className="p-8 bg-indigo-600/5 dark:bg-indigo-600/5 rounded-[2.5rem] border-2 border-indigo-600/10 flex flex-col items-center justify-center text-center">
            <div className="text-3xl font-black text-indigo-600">{items.filter(i=>i.status===ProcessingStatus.COMPLETED).length}</div>
            <div className="text-[10px] font-black text-indigo-600/60 uppercase tracking-widest mt-1">Files Finished</div>
          </div>
        </div>

        <section className="space-y-6">
           <h2 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 px-2 flex items-center">
             <i className="fa-solid fa-cloud-arrow-up mr-3 text-indigo-500"></i>
             Upload Pipeline
           </h2>
           <FileUploader onFilesSelected={handleFilesSelected} />
        </section>

        <section className="space-y-10 pb-20">
          <h2 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 px-2 flex items-center">
             <i className="fa-solid fa-list-check mr-3 text-indigo-500"></i>
             Active Tasks ({items.length})
          </h2>
          <div className="space-y-10">
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
                onRetry={id => setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.IDLE, validationReport: undefined } : i))}
              />
            ))}
            {items.length === 0 && (
              <div className="py-32 flex flex-col items-center justify-center bg-slate-100/30 dark:bg-slate-900/30 rounded-[3rem] border-2 border-dashed border-slate-200 dark:border-slate-800">
                 <div className="w-20 h-20 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center mb-6">
                    <i className="fa-solid fa-inbox text-slate-400 text-3xl"></i>
                 </div>
                 <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">No active transcription tasks</p>
                 <p className="text-[10px] text-slate-500 mt-2">Upload audio and JSON files to begin</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default App;