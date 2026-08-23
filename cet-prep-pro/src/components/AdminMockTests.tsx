import { useState, useEffect } from 'react'
import {
  Plus, Search, Edit, Trash2, Eye, PlayCircle, Settings,
  Clock, Users, FileText, CheckCircle, X, Calendar, BarChart3,
  ChevronLeft, ChevronRight, Info, HelpCircle, Lock
} from 'lucide-react'
import { mockTestsAPI, MockTest, questionsAPI } from '../lib/api'

type TabType = 'all' | 'active' | 'scheduled' | 'draft'

export default function AdminMockTests() {
  const [mockTests, setMockTests] = useState<MockTest[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [search, setSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [currentStep, setCurrentStep] = useState(1)
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([])
  const [availableChaptersBySubject, setAvailableChaptersBySubject] = useState<Record<string, string[]>>({})
  const [loadingMeta, setLoadingMeta] = useState(false)

  const [formData, setFormData] = useState({
    // Step 1: Basic Information
    title: '',
    description: '',
    category: 'PCM',
    subject: 'Physics',
    difficulty: 'Medium',

    // Step 2: Test Settings
    totalQuestions: 150,
    totalMarks: 600,
    duration: 180,
    negativeMarking: true,
    marksPerQuestion: 4,
    passingMarks: 240,
    maxAttempts: 1,
    shuffleQuestions: false,
    shuffleOptions: true,

    // Step 3: Question Selection
    questionSelection: 'bank',
    selectedQuestions: [] as string[],

    // Step 4: Chapter Selection
    selectedChapters: {
      physics: ['Laws of Motion', 'Current Electricity'],
      chemistry: ['Organic Chemistry'],
      mathematics: ['Calculus'],
    } as Record<string, string[]>,

    // Step 5: Test Instructions
    instructions: '',

    // Step 6: Scheduling
    publishNow: true,
    scheduleDate: '',
    scheduleTime: '',
    expiryDate: '',
    timeZone: 'Asia/Kolkata',

    // Step 7: Visibility
    visibility: 'draft' as 'draft' | 'published' | 'private' | 'public',
  })

  const loadMockTests = async () => {
    try {
      const data = await mockTestsAPI.getAll()
      setMockTests(data)
    } catch (error) {
      console.error('Failed to load mock tests:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadQuestionBankMeta = async () => {
    setLoadingMeta(true)
    try {
      const data = await questionsAPI.getSubjectsAndChapters()
      setAvailableSubjects(data.subjects)
      setAvailableChaptersBySubject(data.chaptersBySubject)
    } catch (error) {
      console.error('Failed to load question bank metadata:', error)
    } finally {
      setLoadingMeta(false)
    }
  }

  const handleCreateTest = async () => {
    try {
      const status = formData.publishNow ? 'active' : formData.visibility === 'published' ? 'active' : 'draft'
      const scheduledDate = formData.publishNow ? new Date().toISOString() : 
                          formData.scheduleDate && formData.scheduleTime ? 
                          `${formData.scheduleDate}T${formData.scheduleTime}` : undefined

      await mockTestsAPI.create({
        title: formData.title,
        subject: formData.subject === 'Mixed' ? formData.category : formData.subject,
        difficulty: formData.difficulty as 'Easy' | 'Medium' | 'Hard',
        questions: formData.totalQuestions,
        duration: formData.duration,
        status: status as 'active' | 'scheduled' | 'draft',
        scheduledDate,
        createdBy: 'Admin X',
      })
      setShowCreateModal(false)
      setCurrentStep(1)
      loadMockTests()
    } catch (error) {
      console.error('Failed to create mock test:', error)
      alert('Failed to create test. Please try again.')
    }
  }

  const updateFormData = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const nextStep = () => setCurrentStep(prev => Math.min(7, prev + 1))
  const prevStep = () => setCurrentStep(prev => Math.max(1, prev - 1))

  useEffect(() => {
    loadMockTests()
  }, [])

  useEffect(() => {
    if (showCreateModal) {
      loadQuestionBankMeta()
    }
  }, [showCreateModal])

  const filtered = mockTests.filter(test => {
    const matchesTab = activeTab === 'all' || test.status === activeTab
    const matchesSearch = !search || test.title.toLowerCase().includes(search.toLowerCase()) || test.subject.toLowerCase().includes(search.toLowerCase())
    return matchesTab && matchesSearch
  })

  const stats = {
    total: mockTests.length,
    active: mockTests.filter(t => t.status === 'active').length,
    scheduled: mockTests.filter(t => t.status === 'scheduled').length,
    draft: mockTests.filter(t => t.status === 'draft').length,
    totalAttempts: mockTests.reduce((sum, t) => sum + (t.attempts || 0), 0),
    avgScore: mockTests.length > 0 ? Math.round(mockTests.filter(t => t.avgScore > 0).reduce((sum, t) => sum + t.avgScore, 0) / Math.max(1, mockTests.filter(t => t.avgScore > 0).length)) : 0,
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '--green'
      case 'scheduled': return '--blue'
      case 'draft': return '--gray'
      default: return '--gray'
    }
  }

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'Easy': return '#dcfce7'
      case 'Medium': return '#fef9c3'
      case 'Hard': return '#fee2e2'
      default: return '#f1f5f9'
    }
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <>
            <div className="amt-form-group">
              <label className="amt-label">Mock Test Title *</label>
              <input type="text" className="amt-input" placeholder="e.g., Full Syllabus Mock Test A" value={formData.title} onChange={e => updateFormData('title', e.target.value)} />
            </div>
            <div className="amt-form-group">
              <label className="amt-label">Description (Optional)</label>
              <textarea className="amt-textarea" rows={3} placeholder="Brief description of the test..." value={formData.description} onChange={e => updateFormData('description', e.target.value)} />
            </div>
            <div className="amt-form-row">
              <div className="amt-form-group">
                <label className="amt-label">Category</label>
                <select className="amt-select" value={formData.category} onChange={e => updateFormData('category', e.target.value)}>
                  <option>PCM</option>
                  <option>PCB</option>
                </select>
              </div>
              <div className="amt-form-group">
                <label className="amt-label">Subject *</label>
                <select className="amt-select" value={formData.subject} onChange={e => updateFormData('subject', e.target.value)}>
                  {availableSubjects.map(subject => (
                    <option key={subject} value={subject}>{subject}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="amt-form-group">
              <label className="amt-label">Difficulty Level *</label>
              <select className="amt-select" value={formData.difficulty} onChange={e => updateFormData('difficulty', e.target.value)}>
                <option>Easy</option>
                <option>Medium</option>
                <option>Hard</option>
                <option>Mixed</option>
              </select>
            </div>
          </>
        )

      case 2:
        return (
          <>
            <div className="amt-form-row">
              <div className="amt-form-group">
                <label className="amt-label">Total Questions *</label>
                <input type="number" className="amt-input" value={formData.totalQuestions} onChange={e => updateFormData('totalQuestions', parseInt(e.target.value))} />
              </div>
              <div className="amt-form-group">
                <label className="amt-label">Total Marks *</label>
                <input type="number" className="amt-input" value={formData.totalMarks} onChange={e => updateFormData('totalMarks', parseInt(e.target.value))} />
              </div>
            </div>
            <div className="amt-form-row">
              <div className="amt-form-group">
                <label className="amt-label">Duration (Minutes) *</label>
                <input type="number" className="amt-input" value={formData.duration} onChange={e => updateFormData('duration', parseInt(e.target.value))} />
              </div>
              <div className="amt-form-group">
                <label className="amt-label">Marks per Question</label>
                <input type="number" className="amt-input" value={formData.marksPerQuestion} onChange={e => updateFormData('marksPerQuestion', parseInt(e.target.value))} />
              </div>
            </div>
            <div className="amt-form-row">
              <div className="amt-form-group">
                <label className="amt-label">Passing Marks</label>
                <input type="number" className="amt-input" value={formData.passingMarks} onChange={e => updateFormData('passingMarks', parseInt(e.target.value))} />
              </div>
              <div className="amt-form-group">
                <label className="amt-label">Maximum Attempts</label>
                <input type="number" className="amt-input" value={formData.maxAttempts} onChange={e => updateFormData('maxAttempts', parseInt(e.target.value))} />
              </div>
            </div>
            <div className="amt-form-group">
              <label className="amt-checkbox-label">
                <input type="checkbox" checked={formData.negativeMarking} onChange={e => updateFormData('negativeMarking', e.target.checked)} />
                <span>Enable Negative Marking</span>
              </label>
            </div>
            <div className="amt-form-row">
              <div className="amt-form-group">
                <label className="amt-checkbox-label">
                  <input type="checkbox" checked={formData.shuffleQuestions} onChange={e => updateFormData('shuffleQuestions', e.target.checked)} />
                  <span>Shuffle Questions</span>
                </label>
              </div>
              <div className="amt-form-group">
                <label className="amt-checkbox-label">
                  <input type="checkbox" checked={formData.shuffleOptions} onChange={e => updateFormData('shuffleOptions', e.target.checked)} />
                  <span>Shuffle Options</span>
                </label>
              </div>
            </div>
          </>
        )

      case 3:
        return (
          <>
            <div className="amt-form-group">
              <label className="amt-label">Question Selection Method</label>
              <div className="amt-radio-group">
                <label className="amt-radio-label">
                  <input type="radio" name="questionSelection" value="bank" checked={formData.questionSelection === 'bank'} onChange={e => updateFormData('questionSelection', e.target.value)} />
                  <span>Select from Question Bank</span>
                </label>
                <label className="amt-radio-label">
                  <input type="radio" name="questionSelection" value="create" checked={formData.questionSelection === 'create'} onChange={e => updateFormData('questionSelection', e.target.value)} />
                  <span>Create New Question</span>
                </label>
              </div>
            </div>

            {formData.questionSelection === 'bank' && (
              <>
                <div className="amt-form-row">
                  <div className="amt-form-group">
                    <label className="amt-label">Subject</label>
                    <select className="amt-select">
                      <option>All Subjects</option>
                      {availableSubjects.map(subject => (
                        <option key={subject} value={subject}>{subject}</option>
                      ))}
                    </select>
                  </div>
                  <div className="amt-form-group">
                    <label className="amt-label">Difficulty</label>
                    <select className="amt-select">
                      <option>All Difficulties</option>
                      <option>Easy</option>
                      <option>Medium</option>
                      <option>Hard</option>
                    </select>
                  </div>
                </div>
                <div className="amt-form-group">
                  <label className="amt-label">Chapter</label>
                  <select className="amt-select">
                    <option>All Chapters</option>
                    {Object.values(availableChaptersBySubject).flat().map(chapter => (
                      <option key={chapter} value={chapter}>{chapter}</option>
                    ))}
                  </select>
                </div>
                <div className="amt-info-box">
                  <Info size={16} />
                  <p>Select questions from the question bank based on filters. Questions will be automatically selected based on your criteria.</p>
                </div>
              </>
            )}

            {formData.questionSelection === 'create' && (
              <div className="amt-form-group">
                <label className="amt-label">Question Type</label>
                <select className="amt-select">
                  <option>Single Correct MCQ</option>
                  <option>Multiple Correct</option>
                  <option>Numerical Answer</option>
                  <option>Assertion & Reason</option>
                  <option>Match the Following</option>
                </select>
              </div>
            )}
          </>
        )

      case 4:
        return (
          <div className="amt-chapters-container">
            {formData.category === 'PCM' ? (
              <>
                <div className="amt-chapter-section">
                  <h4>Physics</h4>
                  <div className="amt-chapter-list">
                    {(availableChaptersBySubject['Physics'] || []).length > 0 
                      ? availableChaptersBySubject['Physics'].map(chapter => {
                          const isSelected = formData.selectedChapters.physics?.includes(chapter)
                          return (
                            <label key={chapter} className="amt-checkbox-label">
                              <input 
                                type="checkbox" 
                                checked={isSelected} 
                                onChange={e => {
                                  const current = formData.selectedChapters.physics || []
                                  const updated = e.target.checked 
                                    ? [...current, chapter]
                                    : current.filter(c => c !== chapter)
                                  updateFormData('selectedChapters', { ...formData.selectedChapters, physics: updated })
                                }} 
                              />
                              <span>{chapter}</span>
                            </label>
                          )
                        })
                      : <p className="amt-no-chapters">No chapters available in question bank</p>
                    }
                  </div>
                </div>
                <div className="amt-chapter-section">
                  <h4>Chemistry</h4>
                  <div className="amt-chapter-list">
                    {(availableChaptersBySubject['Chemistry'] || []).length > 0 
                      ? availableChaptersBySubject['Chemistry'].map(chapter => {
                          const isSelected = formData.selectedChapters.chemistry?.includes(chapter)
                          return (
                            <label key={chapter} className="amt-checkbox-label">
                              <input 
                                type="checkbox" 
                                checked={isSelected} 
                                onChange={e => {
                                  const current = formData.selectedChapters.chemistry || []
                                  const updated = e.target.checked 
                                    ? [...current, chapter]
                                    : current.filter(c => c !== chapter)
                                  updateFormData('selectedChapters', { ...formData.selectedChapters, chemistry: updated })
                                }} 
                              />
                              <span>{chapter}</span>
                            </label>
                          )
                        })
                      : <p className="amt-no-chapters">No chapters available in question bank</p>
                    }
                  </div>
                </div>
                <div className="amt-chapter-section">
                  <h4>Mathematics</h4>
                  <div className="amt-chapter-list">
                    {(availableChaptersBySubject['Mathematics'] || []).length > 0 
                      ? availableChaptersBySubject['Mathematics'].map(chapter => {
                          const isSelected = formData.selectedChapters.mathematics?.includes(chapter)
                          return (
                            <label key={chapter} className="amt-checkbox-label">
                              <input 
                                type="checkbox" 
                                checked={isSelected} 
                                onChange={e => {
                                  const current = formData.selectedChapters.mathematics || []
                                  const updated = e.target.checked 
                                    ? [...current, chapter]
                                    : current.filter(c => c !== chapter)
                                  updateFormData('selectedChapters', { ...formData.selectedChapters, mathematics: updated })
                                }} 
                              />
                              <span>{chapter}</span>
                            </label>
                          )
                        })
                      : <p className="amt-no-chapters">No chapters available in question bank</p>
                    }
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="amt-chapter-section">
                  <h4>Physics</h4>
                  <div className="amt-chapter-list">
                    {(availableChaptersBySubject['Physics'] || []).length > 0 
                      ? availableChaptersBySubject['Physics'].map(chapter => {
                          const isSelected = formData.selectedChapters.physics?.includes(chapter)
                          return (
                            <label key={chapter} className="amt-checkbox-label">
                              <input 
                                type="checkbox" 
                                checked={isSelected} 
                                onChange={e => {
                                  const current = formData.selectedChapters.physics || []
                                  const updated = e.target.checked 
                                    ? [...current, chapter]
                                    : current.filter(c => c !== chapter)
                                  updateFormData('selectedChapters', { ...formData.selectedChapters, physics: updated })
                                }} 
                              />
                              <span>{chapter}</span>
                            </label>
                          )
                        })
                      : <p className="amt-no-chapters">No chapters available in question bank</p>
                    }
                  </div>
                </div>
                <div className="amt-chapter-section">
                  <h4>Chemistry</h4>
                  <div className="amt-chapter-list">
                    {(availableChaptersBySubject['Chemistry'] || []).length > 0 
                      ? availableChaptersBySubject['Chemistry'].map(chapter => {
                          const isSelected = formData.selectedChapters.chemistry?.includes(chapter)
                          return (
                            <label key={chapter} className="amt-checkbox-label">
                              <input 
                                type="checkbox" 
                                checked={isSelected} 
                                onChange={e => {
                                  const current = formData.selectedChapters.chemistry || []
                                  const updated = e.target.checked 
                                    ? [...current, chapter]
                                    : current.filter(c => c !== chapter)
                                  updateFormData('selectedChapters', { ...formData.selectedChapters, chemistry: updated })
                                }} 
                              />
                              <span>{chapter}</span>
                            </label>
                          )
                        })
                      : <p className="amt-no-chapters">No chapters available in question bank</p>
                    }
                  </div>
                </div>
                <div className="amt-chapter-section">
                  <h4>Biology</h4>
                  <div className="amt-chapter-list">
                    {(availableChaptersBySubject['Biology'] || []).length > 0 
                      ? availableChaptersBySubject['Biology'].map(chapter => {
                          const isSelected = formData.selectedChapters.biology?.includes(chapter)
                          return (
                            <label key={chapter} className="amt-checkbox-label">
                              <input 
                                type="checkbox" 
                                checked={isSelected} 
                                onChange={e => {
                                  const current = formData.selectedChapters.biology || []
                                  const updated = e.target.checked 
                                    ? [...current, chapter]
                                    : current.filter(c => c !== chapter)
                                  updateFormData('selectedChapters', { ...formData.selectedChapters, biology: updated })
                                }} 
                              />
                              <span>{chapter}</span>
                            </label>
                          )
                        })
                      : <p className="amt-no-chapters">No chapters available in question bank</p>
                    }
                  </div>
                </div>
              </>
            )}
          </div>
        )

      case 5:
        return (
          <div className="amt-form-group">
            <label className="amt-label">Test Instructions</label>
            <textarea 
              className="amt-textarea" 
              rows={8} 
              placeholder="Enter test instructions here...

Example:
• No calculator allowed.
• Test cannot be paused once started.
• Negative marking applies for wrong answers.
• Read every question carefully before answering.
• Submit the test before time expires." 
              value={formData.instructions}
              onChange={e => updateFormData('instructions', e.target.value)}
            />
          </div>
        )

      case 6:
        return (
          <>
            <div className="amt-form-group">
              <label className="amt-label">Publishing Option</label>
              <div className="amt-radio-group">
                <label className="amt-radio-label">
                  <input type="radio" name="publish" checked={formData.publishNow} onChange={() => updateFormData('publishNow', true)} />
                  <span>Publish Now</span>
                </label>
                <label className="amt-radio-label">
                  <input type="radio" name="publish" checked={!formData.publishNow} onChange={() => updateFormData('publishNow', false)} />
                  <span>Schedule for Later</span>
                </label>
              </div>
            </div>

            {!formData.publishNow && (
              <>
                <div className="amt-form-row">
                  <div className="amt-form-group">
                    <label className="amt-label">Schedule Date</label>
                    <input type="date" className="amt-input" value={formData.scheduleDate} onChange={e => updateFormData('scheduleDate', e.target.value)} />
                  </div>
                  <div className="amt-form-group">
                    <label className="amt-label">Schedule Time</label>
                    <input type="time" className="amt-input" value={formData.scheduleTime} onChange={e => updateFormData('scheduleTime', e.target.value)} />
                  </div>
                </div>
                <div className="amt-form-row">
                  <div className="amt-form-group">
                    <label className="amt-label">Expiry Date</label>
                    <input type="date" className="amt-input" value={formData.expiryDate} onChange={e => updateFormData('expiryDate', e.target.value)} />
                  </div>
                  <div className="amt-form-group">
                    <label className="amt-label">Time Zone</label>
                    <select className="amt-select" value={formData.timeZone} onChange={e => updateFormData('timeZone', e.target.value)}>
                      <option>Asia/Kolkata</option>
                      <option>Asia/Mumbai</option>
                      <option>Asia/Delhi</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </>
        )

      case 7:
        return (
          <div className="amt-form-group">
            <label className="amt-label">Visibility *</label>
            <div className="amt-visibility-options">
              <label className={`amt-visibility-card ${formData.visibility === 'draft' ? 'active' : ''}`}>
                <input type="radio" name="visibility" value="draft" checked={formData.visibility === 'draft'} onChange={e => updateFormData('visibility', e.target.value as any)} />
                <div className="amt-visibility-content">
                  <FileText size={24} />
                  <h5>Draft</h5>
                  <p>Save as draft, not visible to students</p>
                </div>
              </label>
              <label className={`amt-visibility-card ${formData.visibility === 'published' ? 'active' : ''}`}>
                <input type="radio" name="visibility" value="published" checked={formData.visibility === 'published'} onChange={e => updateFormData('visibility', e.target.value as any)} />
                <div className="amt-visibility-content">
                  <CheckCircle size={24} />
                  <h5>Published</h5>
                  <p>Make test available to all students</p>
                </div>
              </label>
              <label className={`amt-visibility-card ${formData.visibility === 'private' ? 'active' : ''}`}>
                <input type="radio" name="visibility" value="private" checked={formData.visibility === 'private'} onChange={e => updateFormData('visibility', e.target.value as any)} />
                <div className="amt-visibility-content">
                  <Lock size={24} />
                  <h5>Private</h5>
                  <p>Only accessible via direct link</p>
                </div>
              </label>
              <label className={`amt-visibility-card ${formData.visibility === 'public' ? 'active' : ''}`}>
                <input type="radio" name="visibility" value="public" checked={formData.visibility === 'public'} onChange={e => updateFormData('visibility', e.target.value as any)} />
                <div className="amt-visibility-content">
                  <Users size={24} />
                  <h5>Public</h5>
                  <p>Listed publicly for all users</p>
                </div>
              </label>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  const getStepTitle = (step: number) => {
    switch (step) {
      case 1: return 'Basic Information'
      case 2: return 'Test Settings'
      case 3: return 'Question Selection'
      case 4: return 'Chapter Selection'
      case 5: return 'Test Instructions'
      case 6: return 'Scheduling'
      case 7: return 'Visibility'
      default: return ''
    }
  }

  return (
    <div className="amt-root">
      {/* Header */}
      <div className="amt-header">
        <div>
          <h1 className="amt-title">Mock Tests Management</h1>
          <p className="amt-sub">Create, schedule, and manage mock tests</p>
        </div>
        <button className="amt-create-btn" onClick={() => setShowCreateModal(true)}>
          <Plus size={18} />
          Create New Test
        </button>
      </div>

      {/* Stats */}
      <div className="amt-stats-grid">
        <div className="amt-stat-card">
          <div className="amt-stat-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
            <FileText size={22} />
          </div>
          <div>
            <p className="amt-stat-label">Total Tests</p>
            <p className="amt-stat-value">{stats.total}</p>
          </div>
        </div>
        <div className="amt-stat-card">
          <div className="amt-stat-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>
            <PlayCircle size={22} />
          </div>
          <div>
            <p className="amt-stat-label">Active</p>
            <p className="amt-stat-value">{stats.active}</p>
          </div>
        </div>
        <div className="amt-stat-card">
          <div className="amt-stat-icon" style={{ background: '#fef9c3', color: '#a16207' }}>
            <Calendar size={22} />
          </div>
          <div>
            <p className="amt-stat-label">Scheduled</p>
            <p className="amt-stat-value">{stats.scheduled}</p>
          </div>
        </div>
        <div className="amt-stat-card">
          <div className="amt-stat-icon" style={{ background: '#f1f5f9', color: '#64748b' }}>
            <BarChart3 size={22} />
          </div>
          <div>
            <p className="amt-stat-label">Total Attempts</p>
            <p className="amt-stat-value">{stats.totalAttempts.toLocaleString()}</p>
          </div>
        </div>
        <div className="amt-stat-card">
          <div className="amt-stat-icon" style={{ background: '#faf5ff', color: '#8b5cf6' }}>
            <CheckCircle size={22} />
          </div>
          <div>
            <p className="amt-stat-label">Avg Score</p>
            <p className="amt-stat-value">{stats.avgScore}%</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="amt-toolbar">
        <div className="amt-tabs">
          {[
            { key: 'all', label: 'All Tests' },
            { key: 'active', label: 'Active' },
            { key: 'scheduled', label: 'Scheduled' },
            { key: 'draft', label: 'Draft' },
          ].map(tab => (
            <button
              key={tab.key}
              className={`amt-tab${activeTab === tab.key ? ' amt-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.key as TabType)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="amt-toolbar-right">
          <div className="amt-search-wrap">
            <Search size={16} className="amt-search-icon" />
            <input
              type="text"
              className="amt-search-input"
              placeholder="Search tests..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Tests Table */}
      <div className="amt-table-container">
        <table className="amt-table">
          <thead>
            <tr>
              <th>Test Name</th>
              <th>Subject</th>
              <th>Questions</th>
              <th>Duration</th>
              <th>Difficulty</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Avg Score</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="amt-empty">
                  <FileText size={48} />
                  <p>No tests found</p>
                </td>
              </tr>
            ) : (
              filtered.map(test => (
                <tr key={test._id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{test.title}</div>
                    {test.scheduledDate && (
                      <div style={{ fontSize: 11, color: '#2563eb', marginTop: 2 }}>
                        <Calendar size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                        {new Date(test.scheduledDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}{' '}
                        {new Date(test.scheduledDate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </td>
                  <td>{test.subject}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <FileText size={14} />
                      {test.questions}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={14} />
                      {test.duration} min
                    </div>
                  </td>
                  <td>
                    <span className="amt-diff-badge" style={{ background: getDifficultyColor(test.difficulty), color: test.difficulty === 'Easy' ? '#15803d' : test.difficulty === 'Medium' ? '#a16207' : '#dc2626' }}>
                      {test.difficulty}
                    </span>
                  </td>
                  <td>
                    <span className={`amt-status-badge amt-status-badge--${test.status}`}>
                      {test.status === 'active' && <CheckCircle size={12} />}
                      {test.status.charAt(0).toUpperCase() + test.status.slice(1)}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Users size={14} />
                      {test.attempts.toLocaleString()}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <BarChart3 size={14} />
                      {test.avgScore > 0 ? `${test.avgScore}%` : '—'}
                    </div>
                  </td>
                  <td>{new Date(test.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td>
                    <div className="amt-actions">
                      <button className="amt-action-btn" title="View Details">
                        <Eye size={16} />
                      </button>
                      <button className="amt-action-btn" title="Edit">
                        <Edit size={16} />
                      </button>
                      <button className="amt-action-btn" title="Settings">
                        <Settings size={16} />
                      </button>
                      <button className="amt-action-btn amt-action-btn--danger" title="Delete">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Modal with Steps */}
      {showCreateModal && (
        <div className="amt-modal-overlay" onClick={() => setShowCreateModal(false)}>
<div className="amt-modal amt-modal--fullscreen" onClick={e => e.stopPropagation()}>
            <div className="amt-modal-header">
              <h2>Create New Mock Test</h2>
              <button className="amt-modal-close" onClick={() => setShowCreateModal(false)}>
                <X size={20} />
              </button>
            </div>

            {/* Step Indicators */}
            <div className="amt-step-indicators">
              {[1, 2, 3, 4, 5, 6, 7].map(step => (
                <div key={step} className={`amt-step ${currentStep === step ? 'active' : ''} ${currentStep > step ? 'completed' : ''}`}>
                  <div className="amt-step-number">{step}</div>
                  <div className="amt-step-title">{getStepTitle(step)}</div>
                </div>
              ))}
            </div>

            <div className="amt-modal-body">
              {renderStepContent()}
            </div>

            <div className="amt-modal-footer">
              <button className="amt-btn amt-btn-secondary" onClick={() => { setShowCreateModal(false); setCurrentStep(1) }}>
                Cancel
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                {currentStep > 1 && (
                  <button className="amt-btn amt-btn-secondary" onClick={prevStep}>
                    <ChevronLeft size={16} />
                    Back
                  </button>
                )}
                {currentStep < 7 ? (
                  <button className="amt-btn amt-btn-primary" onClick={nextStep}>
                    Next
                    <ChevronRight size={16} />
                  </button>
                ) : (
                  <button className="amt-btn amt-btn-primary" onClick={handleCreateTest}>
                    <Plus size={16} />
                    Create Test
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}