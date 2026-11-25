import { useEffect, useState, type CSSProperties } from 'react'
import './landingPage.css'

function Glyph({ name, size = 20 }: { name: string; size?: number }) {
  return <span className="lp-glyph material-symbols-outlined" style={{ fontSize: size }} aria-hidden="true">{name}</span>
}

interface LandingPageProps {
  onLogin: () => void
  onStartPreparing: () => void
}

const steps = [
  {
    number: '01',
    icon: 'menu_book',
    title: 'Choose your practice',
    description: 'Explore the mock tests available to you, from full-length exams to subject and chapter-wise practice.',
  },
  {
    number: '02',
    icon: 'schedule',
    title: 'Practice under time',
    description: 'Take a timed test in an exam-style interface and work through questions at your own pace.',
  },
  {
    number: '03',
    icon: 'bar_chart',
    title: 'Review your results',
    description: 'See your score, answer summary and subject-wise results after completing a test.',
  },
]

const features = [
  {
    icon: 'assignment',
    title: 'Mock tests in one place',
    description: 'Browse the mock exams published for your student account.',
  },
  {
    icon: 'schedule',
    title: 'Timed exam experience',
    description: 'Practice with a test timer and a focused, exam-style interface.',
  },
  {
    icon: 'menu_book',
    title: 'Flexible test formats',
    description: 'Find full-length, subject-wise, chapter-wise and previous-year tests when available.',
  },
  {
    icon: 'check_circle',
    title: 'Results after every attempt',
    description: 'Review your score and see correct, incorrect and unanswered questions.',
  },
  {
    icon: 'bar_chart',
    title: 'Subject-wise performance',
    description: 'Compare subject scores from completed tests to understand how you are doing.',
  },
  {
    icon: 'school',
    title: 'Your progress, at a glance',
    description: 'Return to your test history and performance analytics from your student dashboard.',
  },
]

const subjects = [
  {
    name: 'Physics',
    short: 'PH',
    icon: 'science',
    description: 'Explore available physics mock tests and review your results.',
  },
  {
    name: 'Chemistry',
    short: 'CH',
    icon: 'menu_book',
    description: 'Practice with chemistry tests published for your account.',
  },
  {
    name: 'Mathematics',
    short: 'MA',
    icon: 'bar_chart',
    description: 'Find mathematics practice and track scores from completed tests.',
  },
]

function DashboardPreview() {
  return (
    <div className="lp-preview-shell" aria-label="Illustration of the student dashboard">
      <div className="lp-preview-glow" aria-hidden="true" />
      <div className="lp-preview-window">
        <div className="lp-preview-topbar">
          <div className="lp-preview-brand">
            <span className="lp-preview-brand-icon"><Glyph name="school" size={17} /></span>
            <span>CET NOVA</span>
          </div>
          <span className="lp-preview-status"><i aria-hidden="true" /> STUDENT DASHBOARD</span>
          <span className="lp-preview-avatar" aria-hidden="true">S</span>
        </div>

        <div className="lp-preview-content">
          <div className="lp-preview-heading">
            <div>
              <span className="lp-preview-overline">YOUR PREPARATION</span>
              <h2>Your progress, in focus.</h2>
              <p>Insights update as you complete mock tests.</p>
            </div>
            <span className="lp-preview-date">MHT-CET · PCM</span>
          </div>

          <div className="lp-preview-stat-grid">
            <div className="lp-preview-stat">
              <span>Tests attempted</span>
              <strong>—</strong>
              <small>From your test history</small>
            </div>
            <div className="lp-preview-stat">
              <span>Average score</span>
              <strong>—</strong>
              <small>Based on completed tests</small>
            </div>
            <div className="lp-preview-stat">
              <span>Study time</span>
              <strong>—</strong>
              <small>Recorded test duration</small>
            </div>
          </div>

          <div className="lp-preview-panels">
            <div className="lp-preview-chart">
              <div className="lp-preview-panel-head">
                <div>
                  <h3>Score history</h3>
                  <p>Your completed mock tests</p>
                </div>
                <span className="lp-preview-panel-icon"><Glyph name="bar_chart" size={17} /></span>
              </div>
              <div className="lp-preview-empty-chart">
                <span className="lp-preview-chart-mark" aria-hidden="true">
                  <Glyph name="bar_chart" size={22} />
                </span>
                <span>Your score trend will appear here</span>
                <small>Complete a mock test to get started</small>
              </div>
            </div>

            <div className="lp-preview-subjects">
              <div className="lp-preview-panel-head">
                <div>
                  <h3>Subject scores</h3>
                  <p>Results from your tests</p>
                </div>
              </div>
              {subjects.map(subject => (
                <div className="lp-preview-subject" key={subject.name}>
                  <span className="lp-preview-subject-dot" aria-hidden="true" />
                  <span>{subject.name}</span>
                  <strong>—</strong>
                </div>
              ))}
              <span className="lp-preview-note">Scores appear after your first result</span>
            </div>
          </div>
        </div>
      </div>
      <div className="lp-preview-float" aria-hidden="true">
        <span><Glyph name="check" size={15} /></span>
        <div><strong>Every attempt counts</strong><small>Review your results in one place</small></div>
      </div>
    </div>
  )
}

export default function LandingPage({ onLogin, onStartPreparing }: LandingPageProps) {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const root = document.querySelector('.lp-page')
    if (!root || !('IntersectionObserver' in window)) return

    const sections = document.querySelectorAll<HTMLElement>('[data-lp-reveal]')
    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('lp-visible')
          currentObserver.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12 })

    root.classList.add('lp-motion-ready')
    sections.forEach(section => observer.observe(section))
    return () => {
      observer.disconnect()
      root.classList.remove('lp-motion-ready')
    }
  }, [])

  return (
    <div className={`lp-page${isDark ? ' lp-dark' : ''}`}>
      <a className="lp-skip-link" href="#main-content">Skip to content</a>
      <header className="lp-header">
        <div className="lp-header-inner">
          <a className="lp-brand" href="#home" aria-label="CET Nova home">
            <img className="lp-brand-logo" src="/logo.png" alt="" />
          </a>

          <div className="lp-header-actions">
            <button
              type="button"
              className="lp-theme-toggle"
              aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
              aria-pressed={isDark}
              onClick={() => setIsDark(dark => !dark)}
            >
              <Glyph name={isDark ? 'light_mode' : 'dark_mode'} size={19} />
            </button>
            <button type="button" className="lp-button lp-button-small lp-login-cta" onClick={onLogin}>
              Log in
            </button>
          </div>
        </div>
      </header>

      <main id="main-content">
        <section className="lp-hero" id="home">
          <div className="lp-hero-backdrop" aria-hidden="true" />
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy" data-lp-reveal>
              <div className="lp-eyebrow"><span className="lp-eyebrow-dot" /> MADE FOR YOUR MHT-CET PREP</div>
              <h1>Your CET success starts with <span>smart preparation.</span></h1>
              <p className="lp-hero-description">
                Prepare with focused mock tests, practice at your pace and learn from your results — all from one student workspace.
              </p>
              <div className="lp-hero-actions">
                <button type="button" className="lp-button" onClick={onStartPreparing}>
                  Start practicing <Glyph name="arrow_forward" size={17} />
                </button>
                <a className="lp-button lp-button-secondary" href="#subjects">
                  Explore subjects <span className="lp-button-arrow" aria-hidden="true">↓</span>
                </a>
              </div>
              <div className="lp-hero-note">
                <span><Glyph name="check" size={14} /></span>
                Mock tests, results and analytics — together in one place.
              </div>
            </div>

            <div className="lp-hero-visual" data-lp-reveal>
              <DashboardPreview />
            </div>
          </div>
          <div className="lp-hero-bottom" aria-hidden="true">
            <span>LEARN WITH PURPOSE</span><i /><span>PRACTICE WITH FOCUS</span><i /><span>IMPROVE WITH INSIGHT</span>
          </div>
        </section>

        <section className="lp-journey lp-section" id="journey" aria-labelledby="lp-journey-title">
          <div className="lp-container">
            <div className="lp-section-heading lp-section-heading-split" data-lp-reveal>
              <div>
                <span className="lp-kicker">A CLEARER WAY TO PREPARE</span>
                <h2 id="lp-journey-title">Three steps. One focused journey.</h2>
              </div>
              <p>Move from choosing a test to understanding your results, with the tools already in your student workspace.</p>
            </div>
            <div className="lp-journey-grid">
              {steps.map((step, index) => {
                return (
                  <article className="lp-journey-card" data-lp-reveal key={step.number} style={{ '--lp-delay': `${index * 90}ms` } as CSSProperties}>
                    <div className="lp-journey-card-top">
                      <span className="lp-step-number">{step.number}</span>
                      <span className="lp-icon-tile"><Glyph name={step.icon} size={20} /></span>
                    </div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    <span className="lp-card-arrow" aria-hidden="true"><Glyph name="arrow_forward" size={17} /></span>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section className="lp-practice lp-section" id="practice" aria-labelledby="lp-practice-title">
          <div className="lp-container">
            <div className="lp-section-heading lp-section-heading-split" data-lp-reveal>
              <div>
                <span className="lp-kicker">TOOLS FOR THE WORK</span>
                <h2 id="lp-practice-title">Everything you need to practice with intention.</h2>
              </div>
              <button type="button" className="lp-text-link" onClick={onStartPreparing}>Explore mock tests <Glyph name="arrow_forward" size={15} /></button>
            </div>
            <div className="lp-feature-grid">
              {features.map((feature, index) => {
                return (
                  <article className="lp-feature-card" data-lp-reveal key={feature.title} style={{ '--lp-delay': `${(index % 3) * 70}ms` } as CSSProperties}>
                    <span className="lp-icon-tile"><Glyph name={feature.icon} size={20} /></span>
                    <h3>{feature.title}</h3>
                    <p>{feature.description}</p>
                    <span className="lp-card-arrow" aria-hidden="true"><Glyph name="arrow_forward" size={16} /></span>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section className="lp-subjects lp-section" id="subjects" aria-labelledby="lp-subjects-title">
          <div className="lp-container">
            <div className="lp-section-heading lp-subject-heading" data-lp-reveal>
              <span className="lp-kicker">YOUR CET SUBJECTS</span>
              <h2 id="lp-subjects-title">Build confidence, one subject at a time.</h2>
              <p>Explore PCM practice in the subjects supported by the current student test experience.</p>
            </div>
            <div className="lp-subject-grid">
              {subjects.map((subject, index) => {
                return (
                  <article id={`subject-${subject.name.toLowerCase()}`} className={`lp-subject-card lp-subject-card-${subject.short.toLowerCase()}`} data-lp-reveal key={subject.name} style={{ '--lp-delay': `${index * 80}ms` } as CSSProperties}>
                    <div className="lp-subject-card-top">
                      <span className="lp-subject-icon"><Glyph name={subject.icon} size={21} /></span>
                      <span className="lp-subject-code">{subject.short}</span>
                    </div>
                    <h3>{subject.name}</h3>
                    <p>{subject.description}</p>
                    <button type="button" className="lp-subject-link" onClick={onStartPreparing}>
                      Explore practice <Glyph name="arrow_forward" size={15} />
                    </button>
                  </article>
                )
              })}
            </div>
            <p className="lp-subject-footnote">Available tests and topics depend on what has been published for your account.</p>
          </div>
        </section>

        <section className="lp-analysis lp-section" id="analytics" aria-labelledby="lp-analysis-title">
          <div className="lp-container lp-analysis-grid">
            <div className="lp-analysis-copy" data-lp-reveal>
              <span className="lp-kicker">INSIGHT THAT MOVES YOU FORWARD</span>
              <h2 id="lp-analysis-title">Your results are more than a score.</h2>
              <p>After a test, review your score, subject-wise results and answer summary. Your dashboard keeps completed tests together so you can see your own progress over time.</p>
              <ul className="lp-analysis-list">
                <li><Glyph name="check_circle" size={17} /> Correct, incorrect and unanswered responses</li>
                <li><Glyph name="check_circle" size={17} /> Subject-wise scores from completed tests</li>
                <li><Glyph name="check_circle" size={17} /> Test history and performance trends</li>
              </ul>
              <button type="button" className="lp-text-link" onClick={onStartPreparing}>See your student workspace <Glyph name="arrow_forward" size={15} /></button>
            </div>
            <div className="lp-report-card" data-lp-reveal>
              <div className="lp-report-topline"><span>RESULT REVIEW</span><span className="lp-report-badge"><Glyph name="check" size={13} /> PERSONAL TO YOU</span></div>
              <div className="lp-report-title">
                <span className="lp-report-icon"><Glyph name="bar_chart" size={20} /></span>
                <div><h3>Test performance</h3><p>Your answers, in context</p></div>
              </div>
              <div className="lp-report-empty">
                <span className="lp-report-empty-icon"><Glyph name="assignment" size={23} /></span>
                <strong>Your results, not someone else’s.</strong>
                <span>Scores and breakdowns appear here after you complete a test.</span>
              </div>
              <div className="lp-report-footer"><span>Correct answers</span><span>Subject scores</span><span>Test history</span></div>
            </div>
          </div>
        </section>

        <section className="lp-final-cta" aria-labelledby="lp-cta-title">
          <div className="lp-container lp-final-cta-inner" data-lp-reveal>
            <div className="lp-cta-orbit lp-cta-orbit-one" aria-hidden="true" />
            <div className="lp-cta-orbit lp-cta-orbit-two" aria-hidden="true" />
            <div className="lp-cta-content">
              <span className="lp-kicker lp-kicker-light">YOUR NEXT STEP STARTS HERE</span>
              <h2 id="lp-cta-title">Your CET journey starts today.</h2>
              <p>Every question you practice brings you one step closer to your dream college.</p>
              <div className="lp-cta-actions">
                <button type="button" className="lp-button lp-button-light" onClick={onStartPreparing}>Start preparing <Glyph name="arrow_forward" size={16} /></button>
                <button type="button" className="lp-button lp-button-ghost" onClick={onStartPreparing}>Explore mock tests</button>
              </div>
            </div>
            <div className="lp-cta-mark" aria-hidden="true"><Glyph name="school" size={62} /></div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-main">
            <div className="lp-footer-brand">
              <a className="lp-brand" href="#home" aria-label="CET Nova home">
                <img className="lp-brand-logo" src="/logo.png" alt="" />
                <span className="lp-brand-name">CET<span>NOVA</span></span>
              </a>
              <p>A focused student workspace for MHT-CET mock tests, results and performance insights.</p>
            </div>
            <div className="lp-footer-column">
              <h3>Explore</h3>
              <a href="#journey">How it works</a>
              <a href="#practice">Practice features</a>
              <a href="#analytics">Performance</a>
            </div>
            <div className="lp-footer-column">
              <h3>Subjects</h3>
              {subjects.map(subject => <a href={`#subject-${subject.name.toLowerCase()}`} key={subject.name}>{subject.name}</a>)}
            </div>
            <div className="lp-footer-column lp-footer-access">
              <h3>Student access</h3>
              <button type="button" onClick={onLogin}>Log in</button>
              <button type="button" onClick={onStartPreparing}>Explore mock tests</button>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>© {new Date().getFullYear()} CET Nova. All rights reserved.</span>
            <span>MHT-CET preparation · PCM</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
