import React, { useState, useEffect } from 'react';
import { FileUploader } from './components/FileUploader';
import { TranscriptionItemCard } from './components/TranscriptionItemCard';
import { TranscriptionItem, ProcessingStatus } from './types';
import { blobToBase64, validateJsonWithAudio, generateDraftTranscription, alignJsonToAudioAndText } from './services/gemini';

const generateId = () => Math.random().toString(36).substr(2, 9);

const DEFAULT_GUIDELINES = `STRICT TRANSCRIPTION RULES:
1. VERBATIM MODE: Write EXACTLY what is heard.
2. NUMBERS: ALWAYS use digits (e.g., "5", "1990").
3. TAGS: [unintelligible], [music], [foreign].
4. SPELLING (Derja): Use standard Tunisian spelling conventions.
`;

const App: React.FC = () => {
  const [items, setItems] = useState<TranscriptionItem[]>([]);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isCheckingKey, setIsCheckingKey] = useState(true);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' ||
        (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      } else {
        setHasApiKey(true);
      }
      setIsCheckingKey(false);
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      try {
        await window.aistudio.openSelectKey();
        setHasApiKey(true);
      } catch (e) {
        alert("Failed to select API key.");
      }
    } else {
      alert("API Key selection not available.");
    }
  };

  // --- SINGLE ITEM ACTIONS ---

  const handleValidate = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item || !item.inputJson) return; // Silent return for batch safe calls
    
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.VALIDATING_JSON, error: undefined } : i));
    try {
      const base64Audio = await blobToBase64(item.file);
      const report = await validateJsonWithAudio(base64Audio, item.mimeType, item.inputJson);
      setItems(prev => prev.map(i => i.id === id ? { 
        ...i, 
        status: report.isValid ? ProcessingStatus.READY_TO_TRANSCRIBE : ProcessingStatus.ERROR,
        validationReport: report,
        error: report.isValid ? undefined : "Validation failed. Please fix JSON."
      } : i));
    } catch (error: any) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ERROR, error: error.message } : i));
    }
  };

  const handleTranscribeDraft = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.TRANSCRIBING } : i));
    try {
      const base64Audio = await blobToBase64(item.file);
      const onProgress = (text: string) => {
         setItems(prev => prev.map(i => i.id === id ? { ...i, finalTranscription: text } : i));
      };
      const text = await generateDraftTranscription(base64Audio, item.mimeType, DEFAULT_GUIDELINES, onProgress);
      setItems(prev => prev.map(i => i.id === id ? { 
        ...i, 
        status: ProcessingStatus.TEXT_READY,
        finalTranscription: text 
      } : i));
    } catch (error: any) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ERROR, error: error.message } : i));
    }
  };

  const handleAlignJson = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item || !item.finalTranscription) return;
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ALIGNING } : i));
    try {
      const base64Audio = await blobToBase64(item.file);
      const finalJson = await alignJsonToAudioAndText(base64Audio, item.mimeType, item.finalTranscription, item.inputJson);
      setItems(prev => prev.map(i => i.id === id ? { 
        ...i, 
        status: ProcessingStatus.COMPLETED,
        jsonOutput: finalJson
      } : i));
    } catch (error: any) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.ERROR, error: error.message } : i));
    }
  };

  const handleUpdateDraftText = (id: string, text: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, finalTranscription: text } : i));
  };
  const handleUpdateJson = (id: string, json: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, inputJson: json, status: ProcessingStatus.IDLE, validationReport: undefined } : i));
  };
  const handleRemoveItem = (id: string) => setItems(prev => prev.filter(item => item.id !== id));
  
  // --- BATCH ACTIONS ---

  const handleBatchValidate = () => {
    items.forEach(item => {
        if ((item.status === ProcessingStatus.IDLE || item.status === ProcessingStatus.ERROR) && item.inputJson) {
            handleValidate(item.id);
        }
    });
  };

  const handleBatchDraft = () => {
    items.forEach(item => {
        if (item.status === ProcessingStatus.READY_TO_TRANSCRIBE) {
            handleTranscribeDraft(item.id);
        }
    });
  };

  const handleBatchAlign = () => {
    items.forEach(item => {
        if (item.status === ProcessingStatus.TEXT_READY) {
            handleAlignJson(item.id);
        }
    });
  };

  const handleBatchDownload = () => {
    items.forEach(item => {
        if (item.status === ProcessingStatus.COMPLETED && item.jsonOutput) {
            const blob = new Blob([item.jsonOutput], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${item.fileName.replace(/\.[^/.]+$/, "")}_transcribed.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    });
  };

  // --- FILE HANDLING & MATCHING ---

  const handleFilesSelected = async (files: File[]) => {
    const audioFiles = files.filter(f => f.type.startsWith('audio/'));
    const jsonFiles = files.filter(f => f.name.endsWith('.json'));

    // 1. Add Audio Files
    const newItems: TranscriptionItem[] = audioFiles.map(file => ({
      id: generateId(),
      file,
      fileName: file.name,
      mimeType: file.type || 'audio/mp3',
      previewUrl: URL.createObjectURL(file),
      status: ProcessingStatus.IDLE,
      inputJson: '',
      addedAt: Date.now()
    }));

    // Update state with new audio items first
    let currentItems = [...newItems, ...items];
    
    // 2. Process JSON files and match to Audio
    for (const jsonFile of jsonFiles) {
        const text = await jsonFile.text();
        const jsonNameBase = jsonFile.name.replace(/\.[^/.]+$/, "").toLowerCase(); // remove extension
        
        // Find matching audio item (by filename ignoring extension)
        const matchIndex = currentItems.findIndex(item => {
            const audioNameBase = item.fileName.replace(/\.[^/.]+$/, "").toLowerCase();
            return audioNameBase === jsonNameBase;
        });

        if (matchIndex !== -1) {
            // Update the matched item with the JSON content
            currentItems[matchIndex] = {
                ...currentItems[matchIndex],
                inputJson: text,
                status: ProcessingStatus.IDLE // Reset to IDLE so it can be validated
            };
        }
    }
    
    setItems(currentItems);
  };

  // Counts for UI
  const pendingValidationCount = items.filter(i => (i.status === ProcessingStatus.IDLE || i.status === ProcessingStatus.ERROR) && i.inputJson).length;
  const readyToDraftCount = items.filter(i => i.status === ProcessingStatus.READY_TO_TRANSCRIBE).length;
  const readyToAlignCount = items.filter(i => i.status === ProcessingStatus.TEXT_READY).length;
  const completedCount = items.filter(i => i.status === ProcessingStatus.COMPLETED).length;

  if (isCheckingKey) return <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-slate-500 dark:text-slate-400">Loading...</div>;
  if (!hasApiKey) return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 text-center max-w-md border border-slate-200 dark:border-slate-700">
           <h1 className="text-xl font-bold mb-4 text-slate-900 dark:text-white">API Key Required</h1>
           <button onClick={handleSelectKey} className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700">Select Key</button>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 pb-20 transition-colors duration-200">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 h-16 flex items-center justify-between px-4 sticky top-0 z-10 shadow-sm transition-colors duration-200">
        <h1 className="text-xl font-bold text-indigo-700 dark:text-indigo-400">Tunisian Transcriber: QA Workflow</h1>
        
        <button 
          onClick={() => setDarkMode(!darkMode)}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          title="Toggle Dark Mode"
        >
          <i className={`fa-solid ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        
        {/* Bulk Actions Toolbar */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-wrap gap-4 items-center justify-between transition-colors duration-200">
           <div className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Bulk Actions:
           </div>
           <div className="flex gap-3">
              <button 
                onClick={handleBatchValidate}
                disabled={pendingValidationCount === 0}
                className="px-4 py-2 bg-slate-800 dark:bg-slate-700 text-white rounded-lg text-sm font-medium hover:bg-slate-900 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                 Validate All ({pendingValidationCount})
              </button>
              
              <button 
                onClick={handleBatchDraft}
                disabled={readyToDraftCount === 0}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                 Draft All ({readyToDraftCount})
              </button>

              <button 
                onClick={handleBatchAlign}
                disabled={readyToAlignCount === 0}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                 Align All ({readyToAlignCount})
              </button>

              {completedCount > 0 && (
                <button 
                  onClick={handleBatchDownload}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
                >
                  <i className="fa-solid fa-download mr-2"></i>
                  Download Completed ({completedCount})
                </button>
              )}
           </div>
        </div>

        <FileUploader onFilesSelected={handleFilesSelected} />
        
        <div className="space-y-4">
           {items.map(item => (
             <TranscriptionItemCard 
               key={item.id} 
               item={item} 
               onRemove={handleRemoveItem}
               onUpdateJsonInput={handleUpdateJson}
               onValidate={handleValidate}
               onTranscribeDraft={handleTranscribeDraft}
               onUpdateDraftText={handleUpdateDraftText}
               onAlignJson={handleAlignJson}
             />
           ))}
        </div>
      </main>
    </div>
  );
};

export default App;