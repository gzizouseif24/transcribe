# Tunisian Arabic Transcriber (Derja)

A specialized React application designed for high-accuracy transcription and timestamp alignment of Tunisian Arabic (Derja) audio using Google's Gemini 3 models.

## 🚀 Key Features

*   **Multi-Agent AI Workflow**: Uses **Gemini 3 Flash Preview** throughout the pipeline for speed and efficiency:
    *   **Phase 1**: Initial raw transcription and linguistic quality assurance.
    *   **Phase 2**: JSON timestamp alignment.
*   **Human-in-the-Loop Design**: Explicitly designed for a "Text First, JSON Second" workflow to ensure the source text is perfect before alignment.
*   **Advanced Audio Player**: Built-in scrubber, speed controls (0.5x - 2x), and time display for easy verification.
*   **Customizable Guidelines**: Global formatting rules (e.g., how to handle music, foreign words) that are injected into the AI context.
*   **Batch Processing**: Handle multiple audio files simultaneously.
*   **Validations**: Built-in sanity checks for speaker counts and timestamp consistency.

## 🛠️ Workflow

This app follows a strict quality-control process:

1.  **Upload**: Add your audio files.
2.  **Generate Draft (Phase 1)**:
    *   The AI generates a raw paragraph of text.
    *   A second AI pass applies formatting rules (spelling, punctuation).
3.  **Review & Edit**:
    *   **Crucial Step**: The user reviews the text in the editor.
    *   Correct any hallucinations or misheard words *before* timestamps are generated.
4.  **Align JSON (Phase 2)**:
    *   Paste a JSON skeleton (containing speakers and timestamps).
    *   The AI acts as a "Forced Aligner," distributing your *corrected* text into the JSON segments without changing the timestamps.

## 📦 Installation

1.  **Clone the repository**
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Environment Setup**:
    *   Get a Google Gemini API Key from [Google AI Studio](https://aistudio.google.com/).
    *   Set the `API_KEY` environment variable in your runner or `.env` file.

## 💻 Tech Stack

*   **Frontend**: React 19, TypeScript
*   **Styling**: Tailwind CSS
*   **AI SDK**: `@google/genai` (v1.37+)
*   **Icons**: FontAwesome

## 📝 Configuration

You can modify the default transcription guidelines in `App.tsx` or dynamically within the UI.

**Default Rules:**
*   Transcribe exactly what is heard.
*   Tag foreign languages as `[english]`, `[french]`, etc.
*   Tag unintelligible speech as `[unintelligible]`.
*   Ignore filler sounds/stutters unless essential for context.

## ⚠️ Requirements

*   **API Key**: Requires a paid or free tier API key from Google Cloud/AI Studio.
*   **Browser**: Modern browser with AudioContext support (Chrome, Edge, Firefox, Safari).