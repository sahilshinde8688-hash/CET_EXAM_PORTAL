import { useState } from 'react'

interface ExamInstructionsProps {
  onStart: () => void
  onCancel: () => void
}

export default function ExamInstructions({ onStart, onCancel }: ExamInstructionsProps) {
  const [agreed, setAgreed] = useState(false)

  return (
    <div className="font-body-md text-on-background selection:bg-primary-fixed bg-background min-h-[100dvh]">
      {/* TopAppBar Section */}
      <header className="fixed inset-x-0 top-0 z-[60] h-14 bg-slate-900 font-public-sans shadow-lg">
        <div className="mx-auto flex h-full w-full items-center justify-between px-4 sm:px-6 lg:px-8">
          <span className="text-base font-bold text-white">CET Exam Session</span>
          <div className="flex items-center gap-3 sm:gap-4">
            <button
              onClick={onCancel}
              className="rounded px-3 py-1.5 text-label-md text-white transition-all hover:bg-slate-800 cursor-pointer sm:px-4"
            >
              Cancel
            </button>
            <div className="h-6 w-px bg-slate-700"></div>
            <div className="flex items-center gap-2 text-white">
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 0, 'wght' 400" }}>timer</span>
              <span className="text-label-md font-mono">00:00:00</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Canvas */}
      <main className="mx-auto w-full max-w-[680px] px-4 pb-28 pt-20 sm:px-6">
        {/* Header Section */}
        <section className="mb-6">
          <h1 className="font-display-lg text-display-lg text-on-background mb-1">General Instructions</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant text-sm">Please read the following rules carefully before beginning your examination.</p>
        </section>

        {/* Critical Warning Box */}
        <div className="mb-6 bg-error-container/30 border border-error/20 p-4 rounded-lg flex gap-3">
          <span className="material-symbols-outlined text-error" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
          <div>
            <h3 className="font-headline-md text-body-md font-bold text-on-error-container mb-1">Full-Screen Mode Requirement</h3>
            <p className="text-on-error-container opacity-90">
              This examination requires you to be in full-screen mode at all times. Switching tabs, minimizing the window, or exiting full-screen will result in an automatic submission and potential disqualification.
            </p>
          </div>
        </div>

        {/* Instructions Grid */}
        <div className="space-y-6">
          {/* Rules Card */}
          <div className="bg-surface-container-lowest border border-outline-variant p-4 rounded-lg shadow-[0px_2px_4px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-3 mb-4">
              <span className="material-symbols-outlined text-primary">gavel</span>
              <h2 className="font-headline-md text-headline-md">Exam Rules</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-primary mt-2.5 flex-shrink-0"></div>
                <p className="text-on-surface-variant">The clock will be set at the server. The countdown timer in the top right corner of the screen will display the remaining time available for you to complete the examination.</p>
              </div>
              <div className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-primary mt-2.5 flex-shrink-0"></div>
                <p className="text-on-surface-variant">You are strictly prohibited from using calculators, mobile phones, or any other electronic devices during the test.</p>
              </div>
              <div className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-primary mt-2.5 flex-shrink-0"></div>
                <p className="text-on-surface-variant">Ensure you have a stable internet connection. In case of disruption, do not refresh; wait for the system to attempt reconnection.</p>
              </div>
              <div className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-primary mt-2.5 flex-shrink-0"></div>
                <p className="text-on-surface-variant">Any suspicious activity or multiple face detections will be flagged by the AI proctoring system.</p>
              </div>
            </div>
          </div>

          {/* Navigation Guide Card */}
          <div className="bg-surface-container-lowest border border-outline-variant p-4 rounded-lg shadow-[0px_2px_4px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-3 mb-4">
              <span className="material-symbols-outlined text-primary">explore</span>
              <h2 className="font-headline-md text-headline-md">Navigating the Portal</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center p-3 bg-surface-container-low rounded-lg">
                <div className="w-10 h-10 flex items-center justify-center bg-green-600 text-white font-bold rounded mr-4">1</div>
                <span className="text-on-surface">Indicates questions you have answered and saved.</span>
              </div>
              <div className="flex items-center p-3 bg-surface-container-low rounded-lg">
                <div className="w-10 h-10 flex items-center justify-center bg-red-600 text-white font-bold rounded mr-4">2</div>
                <span className="text-on-surface">Indicates questions you have viewed but not yet answered.</span>
              </div>
              <div className="flex items-center p-3 bg-surface-container-low rounded-lg">
                <div className="w-10 h-10 flex items-center justify-center bg-yellow-500 text-on-tertiary-container font-bold rounded mr-4">3</div>
                <span className="text-on-surface">Indicates questions marked for later review. These will NOT be evaluated if left unanswered.</span>
              </div>
            </div>
          </div>

          {/* Visual Context Image */}
          <div className="relative w-full h-[240px] rounded-xl overflow-hidden shadow-sm group">
            <img 
              alt="Examination environment" 
              className="w-full h-full object-cover grayscale opacity-80 group-hover:grayscale-0 transition-all duration-500" 
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuB_q6iEWQVBFJNuogQSu6iVWtwkyy9ubcjstHmdzvtsAGYlN3ZQLp2XD5dC8yFpGRh5eH2idRAHdfGcTFqovF8M15nmI2HPwTXGI5DPQDViabZcAhkuQTbm0nKv7eL0G_xAi6uCJkUyl6v-qo2sRWXNi2lLFsn-c4Q_f5YvWXVwkb73kLGUVa6_ZVGSX67qJ8KGcXyVKJbXEjEvyyQJfmO1hkbH0zjM3XVtqJR9pUvYb9Hfaqqf3EvIL9iIDfji4MxIdCvLacnHcmc"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-6">
              <p className="text-white text-label-md font-medium">Standardized Digital Testing Environment - CET 2024</p>
            </div>
          </div>

          {/* Agreement Checkbox */}
          <label className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/10 rounded-lg cursor-pointer hover:bg-primary/10 transition-colors">
            <div className="flex items-center h-6">
              <input 
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="w-5 h-5 text-primary border-outline rounded focus:ring-primary" 
                type="checkbox"
              />
            </div>
            <div className="text-sm">
              <p className="font-bold text-on-surface mb-1">Declaration of Candidate</p>
              <p className="text-on-surface-variant">I have read and understood all the instructions mentioned above. I agree that I will not use any unfair means during the examination and will adhere to the full-screen requirement as specified. I understand that any violation may lead to the cancellation of my test.</p>
            </div>
          </label>
        </div>
      </main>

      {/* Bottom Action Bar */}
      <footer className="fixed inset-x-0 bottom-0 z-50 flex min-h-20 items-center justify-center border-t border-outline-variant bg-white shadow-[0px_-4px_12px_rgba(0,0,0,0.04)]">
        <div className="mx-auto flex w-full max-w-[680px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="hidden md:block">
            <p className="text-label-sm text-on-surface-variant uppercase tracking-widest">Candidate ID: CET-2024-9921</p>
          </div>
          <button 
            disabled={!agreed}
            onClick={onStart}
            className={`px-8 py-3 rounded-lg font-headline-md text-body-md flex items-center gap-2 transition-all ${
              agreed 
                ? 'bg-primary-container text-on-primary-container hover:shadow-lg active:scale-95 cursor-pointer' 
                : 'bg-surface-variant text-on-surface-variant opacity-50 cursor-not-allowed'
            }`}
          >
            Start Test
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>arrow_forward</span>
          </button>
        </div>
      </footer>
    </div>
  )
}
