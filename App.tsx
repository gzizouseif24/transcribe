import React, { useState, useEffect } from 'react';
import { FileUploader } from './components/FileUploader';
import { TranscriptionItemCard } from './components/TranscriptionItemCard';
import { TranscriptionItem, ProcessingStatus } from './types';
import { generateDraftTranscription, blobToBase64, alignJsonToAudioAndText } from './services/gemini';

const generateId = () => Math.random().toString(36).substr(2, 9);

const DEFAULT_GUIDELINES = `STRICT TRANSCRIPTION RULES:

1. VERBATIM MODE (CRITICAL):
   - Write EXACTLY what is heard, word-for-word.
   - Do NOT correct grammar. Do NOT summarize. Do NOT "fix" sentences.
   - If they stutter, write the stutter.

2. NUMBERS & DATES:
   - ALWAYS use digits (Latin 0-9).
   - Example: Write "15" (NOT "khamsa w ashra").
   - Example: Write "1990" (NOT "alf w tes3a...").

3. TAGS:
   - [unintelligible] -> Cannot hear/understand.
   - [music] -> Music playing.
   - [foreign] -> Language other than Arabic/Derja.

4. SPELLING (Derja):
   - Use standard Tunisian spelling conventions.
   - No spaces after "Waw" (e.g., "والله" not "و الله").
`;

const App: React.FC = () => {
  const [items, setItems] = useState<TranscriptionItem[]>([]);
  const [guidelines, setGuidelines] = useState(DEFAULT_GUIDELINES);
  const [showGuidelines, setShowGuidelines] = useState(false);

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