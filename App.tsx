import React, { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid'; 
import { FileUploader } from './components/FileUploader';
import { TranscriptionItemCard } from './components/TranscriptionItemCard';
import { TranscriptionItem, ProcessingStatus } from './types';
import { generateDraftTranscription, blobToBase64, alignJsonToAudioAndText } from './services/gemini';

const generateId = () => Math.random().toString(36).substr(2, 9);

const DEFAULT_GUIDELINES = `Transcription Review Guidelines
القاعدة الذهبية (The Golden Rule)
«اكتب ما تسمعه بالضبط، لا ما تعتقد أنه يجب أن يقال».

1. اللهجات واللغات الأخرى:
- لهجة أخرى: [other_dialect]
- لغة أجنبية: [english] أو [foreign_language]
- كلمات معربة دارجة (مثل "باص"، "فيسبوك"): تكتب بحروف عربية.

2. السكتات والهمهمات:
- التكرار: اكتب الكلمة مكررة "أنا أنا".
- الهمهمات القصيرة: تجاهلها.
- السكتات: لا تكتب شيئًا.

3. الموسيقى والغناء:
- موسيقى فقط: [music]
- غناء باللهجة: اكتب الكلمات (بدون مد حروف مثل "يا لييييل" -> "يا ليل").

4. غير مفهوم:
- ضوضاء تمنع الفهم: [unintelligible]
- لا تخمن الكلمات أبدًا.

5. الإملاء:
- لا مسافة بعد الواو (والله).
- صحح الأخطاء الإملائية الواضحة.
`;

const App: React.FC = () => {
  const [items, setItems] = useState<TranscriptionItem[]>([]);
  const [guidelines, setGuidelines] = useState(DEFAULT_GUIDELINES);
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isCheckingKey, setIsCheckingKey] = useState(true);

  // Check for API Key on mount
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      } else {
        // Fallback for environments without the bridge (e.g. local dev with .env)
        // We assume true here so the UI renders, and services/gemini.ts will throw if it's actually missing.
        setHasApiKey(true);
      }
      setIsCheckingKey(false);
    };
    checkKey();
  }, []);

  // --- Queue Management System ---
  // Watches the items list. If fewer than MAX_CONCURRENCY items are processing,
  // it picks the next QUEUED item and starts it.
  useEffect(() => {
    const MAX_CONCURRENCY = 1; // Strict serial processing to avoid overload
    
    const processingCount = items.filter(
      i => i.status === ProcessingStatus.TRANSCRIBING_TEXT || i.status === ProcessingStatus.ALIGNING_JSON
    ).length;

    if (processingCount < MAX_CONCURRENCY) {
      const nextInQueue = items.find(i => i.status === ProcessingStatus.QUEUED);
      if (nextInQueue) {
        startTextGeneration(nextInQueue.id);
      }
    }
  }, [items]);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      try {
        await window.aistudio.openSelectKey();
        // Assuming success after the dialog closes (race condition mitigation)
        setHasApiKey(true);
      } catch (e) {
        console.error("Failed to select key:", e);
        alert("Failed to select API key. Please try again.");
      }
    } else {
      alert("API Key selection is not available in this environment. Please configure process.env.API_KEY.");
    }
  };

  const handleApiError = (error: any) => {
    const errorStr = error.toString();
    // Reset state to force re-selection for common auth/setup errors
    if (
        errorStr.includes("Requested entity was not found") || 
        errorStr.includes("API Key is missing") ||
        errorStr.includes("403") // Permission denied
    ) {
      setHasApiKey(false);
      alert("API Key issue detected. Please re-select a valid API Key/Project.");
    }
  };

  // Phase 1: Generate Draft Text (Single Pass)
  const startTextGeneration = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;

    // Transition from QUEUED/IDLE to PROCESSING
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: ProcessingStatus.TRANSCRIBING_TEXT } : i));

    try {
      const base64Audio = await blobToBase64(item.file);
      
      // Single Step: Transcribe + Refine in one go
      const draftText = await generateDraftTranscription(base64Audio, item.mimeType, guidelines);
      
      setItems(prev => prev.map(i => i.id === id ? { 
        ...i, 
        finalTranscription: draftText,
        status: ProcessingStatus.TEXT_READY 
      } : i));

    } catch (error: any) {
      console.error(`Error generating text for ${id}:`, error);
      handleApiError(error);
      setItems(prev => prev.map(i => i.id === id ? { 
        ...i, 
        status: ProcessingStatus.ERROR, 
        error: error.message 
      } : i));
    }
  };

  // Triggers batch processing by moving all IDLE items to QUEUED
  const startBatchProcessing = () => {
    setItems(prev => prev.map(item => 
      item.status === ProcessingStatus.IDLE 
        ? { ...item, status: ProcessingStatus.QUEUED } 
        : item
    ));
  };

  // Phase 2: Align with JSON
  const startJsonAlignment = async (id: string, jsonInput: string) => {
    const item = items.find(i => i.id === id);
    if (!item || !item.finalTranscription) {
        alert("Please ensure text transcription is ready before aligning.");
        return;
    }

    setItems(prev => prev.map(i => i.id === id ? { 
        ...i, 
        inputJson: jsonInput,
        status: ProcessingStatus.ALIGNING_JSON 
    } : i));

    try {
      const base64Audio = await blobToBase64(item.file);
      
      const alignedJson = await alignJsonToAudioAndText(
        base64Audio, 
        item.mimeType, 
        item.finalTranscription, 
        jsonInput, 
        guidelines
      );

      setItems(prev => prev.map(i => i.id === id ? { 
        ...i, 
        jsonOutput: alignedJson,
        status: ProcessingStatus.COMPLETED 
      } : i));

    } catch (error: any) {
       console.error(`Error aligning JSON for ${id}:`, error);
       handleApiError(error);
       setItems(prev => prev.map(i => i.id === id ? { 
         ...i, 
         status: ProcessingStatus.ERROR, 
         error: "JSON Alignment failed: " + error.message
       } : i));
    }
  };
  
  const handleRedoJson = (id: string) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, status: ProcessingStatus.TEXT_READY, jsonOutput: undefined } : item
    ));
  };

  const addToQueue = (newFiles: File[]) => {
    const newItems: TranscriptionItem[] = newFiles.map(file => {
      return {
        id: generateId(),
        file: file,
        fileName: file.name,
        mimeType: file.type || 'audio/mp3',
        previewUrl: URL.createObjectURL(file),
        status: ProcessingStatus.IDLE,
        addedAt: Date.now()
      };
    });

    setItems(prev => [...newItems, ...prev]);
  };

  const handleFilesSelected = (files: File[]) => {
    addToQueue(files);
  };

  const handleRemoveItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };
  
  const handleUpdateTranscription = (id: string, newText: string) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, finalTranscription: newText } : item
    ));
  };

  const clearCompleted = () => {
    setItems(prev => prev.filter(item => item.status !== ProcessingStatus.COMPLETED));
  };

  if (isCheckingKey) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 bg-indigo-200 rounded-full mb-4"></div>
          <div className="h-4 w-32 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!hasApiKey) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl">
            <i className="fa-solid fa-key"></i>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Configure API Key</h1>
          <p className="text-slate-600 mb-6">
            To use the Tunisian Arabic Transcriber, select a Google Cloud project with the Gemini API enabled.
          </p>
          
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-left">
            <h3 className="text-sm font-semibold text-amber-800 mb-1">Troubleshooting:</h3>
            <ul className="list-disc list-inside text-xs text-amber-700 space-y-1">
                <li>If your project doesn't appear in the list, verify it has <strong>billing enabled</strong>.</li>
                <li>Ensure the <strong>Gemini API</strong> is enabled in the Google Cloud Console.</li>
                <li>Refresh the page and try selecting again.</li>
            </ul>
          </div>

          <button
            onClick={handleSelectKey}
            className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors shadow-sm mb-4"
          >
            Select Google Gemini API Key
          </button>
          
          <p className="text-xs text-slate-400">
            Billing is required for the project. <br/>
            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">
              Learn more about billing
            </a>
          </p>
        </div>
      </div>
    );
  }

  // Count items ready for batch processing
  const idleCount = items.filter(i => i.status === ProcessingStatus.IDLE).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
             <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
               <i className="fa-solid fa-language"></i>
             </div>
             <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
               Tunisian Arabic Transcriber
             </h1>
          </div>
          <div className="text-xs text-slate-500 hidden sm:block">
            Sequential Workflow: Text First, Then JSON
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Intro */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800 mb-2">How to use</h2>
          <ol className="list-decimal list-inside space-y-2 text-slate-600 text-sm">
            <li><strong>Generate Text:</strong> The app creates a draft transcription of the audio.</li>
            <li><strong>Edit & Verify:</strong> Correct the text manually to ensure it's perfect.</li>
            <li><strong>Align JSON:</strong> Paste your JSON skeleton (speakers/times). The AI will fill it using your corrected text.</li>
          </ol>
        </div>

        {/* Guidelines */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <button 
                onClick={() => setShowGuidelines(!showGuidelines)}
                className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
                <div className="flex items-center space-x-2">
                    <i className="fa-solid fa-sliders text-indigo-600"></i>
                    <span className="font-semibold text-slate-800">Global Guidelines</span>
                </div>
                <i className={`fa-solid fa-chevron-${showGuidelines ? 'up' : 'down'} text-slate-400`}></i>
            </button>
            
            {showGuidelines && (
                <div className="p-4 border-t border-slate-100 bg-white">
                    <textarea 
                        value={guidelines}
                        onChange={(e) => setGuidelines(e.target.value)}
                        className="w-full h-64 p-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 text-sm font-mono leading-relaxed"
                    />
                </div>
            )}
        </div>

        {/* Input Area */}
        <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-800">New Task</h2>
            <FileUploader onFilesSelected={handleFilesSelected} />
        </div>

        {/* Queue */}
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-800">
                    Tasks {items.length > 0 && <span className="text-slate-400 font-normal ml-2">({items.length})</span>}
                </h2>
                
                <div className="flex items-center space-x-3">
                   {idleCount > 1 && (
                      <button 
                        onClick={startBatchProcessing}
                        className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm transition-colors"
                      >
                         <i className="fa-solid fa-layer-group mr-2"></i>
                         Process All Drafts ({idleCount})
                      </button>
                   )}
                   
                   {items.some(i => i.status === ProcessingStatus.COMPLETED) && (
                      <button onClick={clearCompleted} className="text-sm text-slate-500 hover:text-indigo-600">
                          Clear Completed
                      </button>
                   )}
                </div>
            </div>

            {items.length === 0 ? (
                <div className="text-center py-12 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <p>No tasks yet</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {items.map(item => (
                        <TranscriptionItemCard 
                            key={item.id} 
                            item={item} 
                            onRemove={handleRemoveItem}
                            onUpdate={handleUpdateTranscription}
                            onStartText={startTextGeneration}
                            onStartJson={startJsonAlignment}
                            onRedoJson={handleRedoJson}
                        />
                    ))}
                </div>
            )}
        </div>
      </main>
    </div>
  );
};

export default App;