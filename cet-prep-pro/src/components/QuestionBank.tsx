import { useState, useEffect, useRef, ChangeEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, PlusCircle, Upload, Search, RefreshCcw,
  Edit2, Trash2, Eye, CheckCircle2, AlertCircle, Database, BrainCircuit, 
  Wand2, SpellCheck, Image as ImageIcon, Video, BookOpen, Layers, Target, Settings,
  Save, X, GripVertical, Plus, MessageSquare, ShieldCheck, Download,
  Copy, FileText, FileSpreadsheet
} from 'lucide-react'
import { exportQuestionBankHTML } from '../lib/exportUtils'
import { questionsAPI, Question, PdfExtractResponse, PdfImportQuestion, CetTaxonomySubject } from '../lib/api'
import { sanitizeQuestionContent } from '../lib/questionContent'
import RichQuestionContent from './RichQuestionContent'
import RichQuestionEditor from './RichQuestionEditor'
import FormattedSolution from './FormattedSolution'
import PdfImportReview from './PdfImportReview'
import AiNotesQuestionGenerator from './AiNotesQuestionGenerator'
import LoadingIndicator from './LoadingIndicator'
import '../question-bank.css'

type Tab = 'dashboard' | 'list' | 'add' | 'bulk'

export default function QuestionBank({ onCreateTest }: { onCreateTest: (questionIds: string[]) => void }) {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard')
  const [questions, setQuestions] = useState<Question[]>([])
  const [chapterCatalog, setChapterCatalog] = useState<CetTaxonomySubject[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [chapterFilter, setChapterFilter] = useState('')
  const [difficultyFilter, setDifficultyFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [toast, setToast] = useState<{msg: string, type: 'success'|'error'} | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ imported: number; total: number; errors: Array<{ row?: number; message: string }> } | null>(null)
  const [uploadError, setUploadError] = useState<{ message: string; details?: any } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pdfInputRef = useRef<HTMLInputElement | null>(null)

  // PDF question extraction (extract -> review -> import)
  const PDF_MAX_MB = 25
  const [pdfStage, setPdfStage] = useState<'idle' | 'working' | 'review'>('idle')
  const [pdfStatus, setPdfStatus] = useState('')
  const [pdfError, setPdfError] = useState<{ message: string } | null>(null)
  const [pdfQuestions, setPdfQuestions] = useState<PdfImportQuestion[]>([])
  const [pdfMeta, setPdfMeta] = useState<PdfExtractResponse['meta'] | null>(null)
  const [importingPdf, setImportingPdf] = useState(false)
  const [showNotesGenerator, setShowNotesGenerator] = useState(false)

  const handleBulkImportClick = () => fileInputRef.current?.click()
  const handlePdfImportClick = () => pdfInputRef.current?.click()
  const handleSubjectCardClick = (subject: string) => {
    setSubjectFilter(subject)
    setChapterFilter('')
    setSearch('')
    setActiveTab('list')
  }
  const handleChapterClick = (chapter: string) => {
    setChapterFilter(chapter)
    setSearch('')
    setActiveTab('list')
  }
  const clearSubjectSelection = () => {
    setSubjectFilter('')
    setChapterFilter('')
  }
  const importSpreadsheet = async (file: File) => {
    setUploadResult(null)
    setUploadError(null)
    setUploading(true)
    try {
      const result = await questionsAPI.upload(file)
      setUploadResult(result)
      showToast(`Imported ${result.imported} of ${result.total} questions`, 'success')
      load()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      const details = error instanceof Error ? (error as any).details : undefined
      setUploadError({ message, details })
      showToast(message, 'error')
    } finally {
      setUploading(false)
    }
  }
  const handleBulkFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) importSpreadsheet(file)
  }

  // ── PDF extraction flow ─────────────────────────────────────────────
  const handlePdfFile = async (file: File) => {
    if (!/\.pdf$/i.test(file.name)) {
      showToast('Please choose a .pdf file for PDF question extraction', 'error')
      return
    }
    if (file.size > PDF_MAX_MB * 1024 * 1024) {
      showToast(`PDF is too large (max ${PDF_MAX_MB}MB)`, 'error')
      return
    }
    setUploadResult(null)
    setUploadError(null)
    setPdfError(null)
    setPdfStage('working')
    setPdfStatus('Uploading PDF… 0%')
    try {
      const result = await questionsAPI.extractPdf(file, (percent, stage) => {
        setPdfStatus(`${stage || 'Processing PDF'}… ${percent}%`)
      })
      if (!result.questions.length) {
        setPdfStage('idle')
        showToast(result.warnings?.[0] || 'No questions could be detected in this PDF', 'error')
        return
      }
      setPdfQuestions(result.questions.map((q) => ({ ...q, selected: true })))
      setPdfMeta(result.meta)
      setPdfStage('review')
      showToast(`Extracted ${result.totalExtracted} questions — review and import`, 'success')
    } catch (error: unknown) {
      setPdfStage('idle')
      const message = error instanceof Error ? error.message : 'PDF extraction failed'
      setPdfError({ message })
      showToast(message, 'error')
    }
  }
  const handlePdfFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) handlePdfFile(file)
  }
  const handlePdfImport = async () => {
    setImportingPdf(true)
    try {
      const result = await questionsAPI.importBatch(pdfQuestions)
      const parts = [`imported ${result.imported}`]
      if (result.replaced) parts.push(`replaced ${result.replaced}`)
      if (result.skipped) parts.push(`skipped ${result.skipped} duplicates`)
      if (result.failed) parts.push(`${result.failed} failed`)
      showToast(`PDF import finished: ${parts.join(', ')}`, result.failed ? 'error' : 'success')
      setPdfStage('idle')
      setPdfQuestions([])
      setPdfMeta(null)
      load()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'PDF import failed'
      showToast(message, 'error')
    } finally {
      setImportingPdf(false)
    }
  }
  const resetPdfReview = () => {
    setPdfStage('idle')
    setPdfQuestions([])
    setPdfMeta(null)
    setPdfError(null)
  }
  const handleBulkDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    if (/\.pdf$/i.test(file.name)) handlePdfFile(file)
    else importSpreadsheet(file)
  }

  const downloadCSV = () => {
    const headers = ['Question ID', 'Subject', 'Topic', 'Difficulty', 'Status', 'Created At']
    const rows = filteredQuestions.map(q => [
      q.questionCode || q._id,
      q.subject,
      q.topic,
      q.difficulty,
      q.isActive ? 'Published' : 'Draft',
      q.createdAt ? new Date(q.createdAt).toLocaleDateString() : 'N/A',
    ])
    const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'questions-export.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    showToast('CSV export started', 'success')
  }

  const handleDownloadPDF = () => exportQuestionBankHTML(filteredQuestions, 'CET Question Bank')

  // Dashboard Stats (Calculated)
  const stats = {
    total: questions.length,
    physics: questions.filter(q => q.subject?.toLowerCase() === 'physics').length,
    chemistry: questions.filter(q => q.subject?.toLowerCase() === 'chemistry').length,
    biology: questions.filter(q => q.subject?.toLowerCase() === 'biology').length,
    math: questions.filter(q => q.subject?.toLowerCase() === 'math' || q.subject?.toLowerCase() === 'mathematics').length,
    easy: questions.filter(q => q.difficulty === 'Easy').length,
    medium: questions.filter(q => q.difficulty === 'Medium').length,
    hard: questions.filter(q => q.difficulty === 'Hard').length,
    addedToday: questions.filter(q => new Date(q.createdAt || '').toDateString() === new Date().toDateString()).length,
  }

  // Edit / Add State
  const initialForm = {
    subject: '', chapter: '', topic: '', subTopic: '', language: 'English',
    difficulty: 'Medium' as 'Easy'|'Medium'|'Hard', qType: 'Single Correct',
    text: '', imageUrl: '', options: ['', '', '', ''], correctIndex: 0,
    marks: 4, negativeMarks: 1, estimatedTime: 2, expectedAccuracy: 65, tags: '',
    solution: '', hints: '', videoUrl: '',
    status: 'Draft', visibility: 'Public'
  }
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(initialForm)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingSolutionImage, setUploadingSolutionImage] = useState(false)
  const [imageInputRef, setImageInputRef] = useState<HTMLInputElement | null>(null)
  
  const resetForm = () => setForm(initialForm)

  // Preview Drawer
  const [previewQ, setPreviewQ] = useState<Question | null>(null)

  const showToast = (msg: string, type: 'success'|'error' = 'success') => {
    setToast({msg, type})
    setTimeout(() => setToast(null), 3000)
  }

  const load = async () => {
    setLoading(true)
    try {
      const data = await questionsAPI.getAllAdmin()
      setQuestions(data)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    questionsAPI.getCetTaxonomy()
      .then(data => setChapterCatalog(data.subjects))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to load chapter list'
        showToast(message, 'error')
      })
  }, [])

  const selectedSubjectChapters = chapterCatalog.find(
    subject => subject.name.toLowerCase() === subjectFilter.toLowerCase(),
  )?.chapters.map(chapter => chapter.name) || []
  const formSubjectChapters = chapterCatalog.find(
    subject => subject.name.toLowerCase() === form.subject.toLowerCase(),
  )?.chapters || []
  const questionChapters = questions
    .filter(q => !subjectFilter || q.subject?.toLowerCase() === subjectFilter.toLowerCase())
    .map(q => q.chapter)
    .filter((chapter): chapter is string => Boolean(chapter))
  const availableChapters = Array.from(new Set([...selectedSubjectChapters, ...questionChapters]))

  const filteredQuestions = questions.filter(q => {
    const query = search.toLowerCase()
    const matchesSearch = !query || q.questionCode?.toLowerCase().includes(query) || q.text?.toLowerCase().includes(query) || q.subject?.toLowerCase().includes(query) || q.topic?.toLowerCase().includes(query) || q.chapter?.toLowerCase().includes(query)
    const matchesSubject = !subjectFilter || q.subject?.toLowerCase() === subjectFilter.toLowerCase()
    const matchesChapter = !chapterFilter || q.chapter === chapterFilter
    const matchesDifficulty = !difficultyFilter || q.difficulty === difficultyFilter
    const matchesStatus = !statusFilter || (statusFilter === 'Published' ? q.isActive : !q.isActive)
    return matchesSearch && matchesSubject && matchesChapter && matchesDifficulty && matchesStatus
  })

  const handleSave = async () => {
    const subject = form.subject.trim()
    const text = form.text.trim()
    if (!subject) return showToast('Select a subject before saving the question.', 'error')
    if (!text) {
      return showToast(
        'Enter the question text. A pasted image is attached separately and does not replace the question text.',
        'error',
      )
    }
    
    const payload = {
      subject,
      chapter: form.chapter,
      topic: form.topic || form.chapter,
      subTopic: form.subTopic,
      text,
      imageUrl: form.imageUrl,
      options: form.options,
      solution: form.solution,
      correctIndex: form.correctIndex,
      marks: form.marks,
      negativeMarks: form.negativeMarks,
      difficulty: form.difficulty,
      isActive: form.status !== 'Archived'
    }

    try {
      if (editingId) {
        await questionsAPI.update(editingId, payload)
        showToast('Question updated successfully')
      } else {
        await questionsAPI.create(payload)
        showToast('Question added successfully')
      }
      setEditingId(null)
      setActiveTab('list')
      load()
    } catch (e: any) {
      showToast(e.message || 'Error saving question', 'error')
    }
  }

  const edit = (q: Question) => {
    setEditingId(q._id)
    setForm({
      ...form,
      subject: q.subject || '', chapter: q.chapter || '', topic: q.topic || '', subTopic: q.subTopic || '', text: sanitizeQuestionContent(q.text || ''), imageUrl: q.imageUrl || '', options: (q.options || ['', '', '', '']).map(sanitizeQuestionContent),
      solution: sanitizeQuestionContent(q.solution || ''),
      correctIndex: q.correctIndex || 0, marks: q.marks || 4, negativeMarks: q.negativeMarks || 1,
      difficulty: q.difficulty || 'Medium', status: q.isActive ? 'Published' : 'Draft'
    })
    setActiveTab('add')
  }

  const duplicate = (q: Question) => {
    setEditingId(null)
    setForm({
      ...form,
      subject: q.subject || '', chapter: q.chapter || '', topic: q.topic || '', subTopic: q.subTopic || '', text: q.text ? `${sanitizeQuestionContent(q.text)} (Copy)` : '', imageUrl: q.imageUrl || '', options: q.options ? q.options.map(sanitizeQuestionContent) : ['', '', '', ''],
      solution: sanitizeQuestionContent(q.solution || ''),
      correctIndex: q.correctIndex || 0, marks: q.marks || 4, negativeMarks: q.negativeMarks || 1,
      difficulty: q.difficulty || 'Medium', status: 'Draft'
    })
    setActiveTab('add')
    showToast('Question duplicated — edit and save as new')
  }

  const uploadQuestionImage = async (file: File) => {
    try {
      setUploadingImage(true)
      const res = await questionsAPI.uploadQuestionImage(file)
      setForm(current => ({ ...current, imageUrl: res.imageUrl }))
      showToast('Question image attached successfully', 'success')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Image upload failed'
      showToast(message, 'error')
    } finally {
      setUploadingImage(false)
    }
  }

  const uploadSolutionImage = async (file: File): Promise<string | void> => {
    try {
      setUploadingSolutionImage(true)
      const res = await questionsAPI.uploadQuestionImage(file)
      showToast('Solution image uploaded successfully', 'success')
      return res.imageUrl
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Image upload failed'
      showToast(message, 'error')
    } finally {
      setUploadingSolutionImage(false)
    }
  }

  const handleQuestionImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadQuestionImage(file)
    e.target.value = ''
  }

  const remove = async (id: string) => {
    if (!confirm('Move to trash?')) return
    try {
      await questionsAPI.remove(id)
      showToast('Question deleted')
      load()
    } catch {
      showToast('Error deleting question', 'error')
    }
  }

  // Fake AI click
  const triggerAI = (task: string) => {
    showToast(`AI ${task} initiated (Coming soon...)`, 'success')
  }

  return (
    <div className="qb-wrap">
      
      {/* HEADER & TABS */}
      <div className="qb-tabs-header">
        <div className="qb-title-area">
          <h2>Question Bank</h2>
          <p>Enterprise Repository & Assessment Engine</p>
        </div>
        <div className="qb-tabs">
          <button className={`qb-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            <LayoutDashboard size={18} /> Dashboard
          </button>
          <button className={`qb-tab-btn ${activeTab === 'list' ? 'active' : ''}`} onClick={() => setActiveTab('list')}>
            <Database size={18} /> Questions
          </button>
          <button className={`qb-tab-btn ${activeTab === 'add' ? 'active' : ''}`} onClick={() => { setEditingId(null); resetForm(); setActiveTab('add') }}>
            <PlusCircle size={18} /> {editingId ? 'Edit' : 'Add New'}
          </button>
          <button className={`qb-tab-btn ${activeTab === 'bulk' ? 'active' : ''}`} onClick={() => setActiveTab('bulk')}>
            <Upload size={18} /> Bulk Import
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.json" style={{ display: 'none' }} onChange={handleBulkFileChange} />
        <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handlePdfFileChange} />
        <input
          ref={node => setImageInputRef(node)}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleQuestionImageUpload}
        />
      </div>

      <AnimatePresence mode="wait">
        
        {/* ================= DASHBOARD TAB ================= */}
        {activeTab === 'dashboard' && (
          <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <div className="qb-stats-grid">
              {[
                { title: 'Total Questions', val: stats.total, icon: Database, trend: '+12% this week', up: true },
                { title: 'Physics', val: stats.physics, icon: BookOpen, trend: '+5 added today', up: true, onClick: () => handleSubjectCardClick('Physics') },
                { title: 'Chemistry', val: stats.chemistry, icon: BookOpen, trend: '+2 added today', up: true, onClick: () => handleSubjectCardClick('Chemistry') },
                { title: 'Biology', val: stats.biology, icon: BookOpen, trend: '+3 added today', up: true, onClick: () => handleSubjectCardClick('Biology') },
                { title: 'Math', val: stats.math, icon: BookOpen, trend: '+8 added today', up: true, onClick: () => handleSubjectCardClick('Math') },
                { title: 'Easy Questions', val: stats.easy, icon: CheckCircle2, trend: '20% of total', up: true },
                { title: 'Medium Questions', val: stats.medium, icon: Target, trend: '60% of total', up: true },
                { title: 'Hard Questions', val: stats.hard, icon: AlertCircle, trend: '20% of total', up: false },
                { title: 'Added Today', val: stats.addedToday, icon: PlusCircle, trend: 'Pending review: 0', up: true },
              ].map((s, i) => (
                <motion.div key={i}
                  className="qb-stat-card"
                  whileHover={{ y: -4 }}
                  onClick={s.onClick}
                  style={s.onClick ? { cursor: 'pointer' } : undefined}
                >
                  <div className="qb-stat-header">
                    <span className="qb-stat-title">{s.title}</span>
                    <div className="qb-stat-icon"><s.icon size={20} /></div>
                  </div>
                  <div className="qb-stat-value">{s.val}</div>
                  <div className={`qb-stat-trend ${s.up ? 'up' : 'down'}`}>
                    {s.trend}
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="qb-card">
              <h3 className="qb-card-title"><BrainCircuit size={20}/> AI Analytics Panel</h3>
              <p style={{color: 'var(--text-muted)'}}>Question usage graphs and difficulty distribution charts will appear here.</p>
            </div>
          </motion.div>
        )}

        {/* ================= LIST TAB ================= */}
        {activeTab === 'list' && (
          <motion.div key="list" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <div className="qb-filter-bar">
              <div className="qb-search-wrapper">
                <Search size={18} className="qb-search-icon" />
                <input type="text" className="qb-input-search" placeholder="Search by question ID, text, subject, or topic..."
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="qb-filter-select" value={subjectFilter} onChange={e => { setSubjectFilter(e.target.value); setChapterFilter('') }}>
                <option value="">Subject: All</option>
                <option value="Physics">Physics</option>
                <option value="Chemistry">Chemistry</option>
                <option value="Biology">Biology</option>
                <option value="Math">Math</option>
              </select>
              <select className="qb-filter-select" value={chapterFilter} onChange={e => setChapterFilter(e.target.value)}>
                <option value="">Chapter: All</option>
                {availableChapters.map(chapter => (
                  <option key={chapter} value={chapter}>{chapter}</option>
                ))}
              </select>
              <select className="qb-filter-select" value={difficultyFilter} onChange={e => setDifficultyFilter(e.target.value)}>
                <option value="">Difficulty: All</option>
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
              <select className="qb-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">Status: All</option>
                <option value="Published">Published</option>
                <option value="Pending Review">Pending Review</option>
                <option value="Draft">Draft</option>
              </select>
              <button className="qb-btn qb-btn-outline" onClick={load}><RefreshCcw size={16}/> Refresh</button>
            </div>

            {subjectFilter && !chapterFilter && (
              <div className="qb-card" style={{marginBottom: 20}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16}}>
                  <div>
                    <div style={{fontSize: 16, fontWeight: 700}}>Choose a chapter in {subjectFilter}</div>
                    <div style={{fontSize: 13, color: 'var(--text-muted)'}}>Click a chapter to view its questions.</div>
                  </div>
                  <button className="qb-btn qb-btn-outline" onClick={clearSubjectSelection}>Clear Subject</button>
                </div>
                <div style={{display: 'grid', gridTemplateColumns: '1fr', gap: 10}}>
                  {availableChapters.length ? availableChapters.map(chapter => (
                    <button key={chapter} className="qb-stat-card" style={{textAlign: 'left', padding: '16px', minHeight: 76, cursor: 'pointer'}} onClick={() => chapter && handleChapterClick(chapter)}>
                      <div style={{fontSize: 14, fontWeight: 700, marginBottom: 8}}>{chapter}</div>
                      <div style={{fontSize: 12, color: 'var(--text-muted)'}}>{questions.filter(q => q.subject?.toLowerCase() === subjectFilter.toLowerCase() && q.chapter === chapter).length} questions</div>
                    </button>
                  )) : (
                    <div style={{color: 'var(--text-muted)'}}>No chapters available for this subject.</div>
                  )}
                </div>
              </div>
            )}
            <div className="qb-table-container">
              <div className="qb-table-toolbar">
                <div style={{fontWeight: 600}}>Showing {filteredQuestions.length} Questions</div>
                <div style={{display: 'flex', gap: '8px'}}>
                  <button className="qb-btn qb-btn-outline" onClick={downloadCSV}><Download size={16}/> Export CSV</button>
                  <button className="qb-btn qb-btn-outline" onClick={handleDownloadPDF}><Download size={16}/> Export PDF</button>
                </div>
              </div>
              <div className="qb-table-scroll">
                <table className="qb-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Subject / Topic</th>
                      <th>Question Snippet</th>
                      <th>Diff / Marks</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? <tr><td colSpan={7}><LoadingIndicator message="Loading questions..." /></td></tr> : null}
                    {filteredQuestions.map(q => (
                      <tr key={q._id}>
                        <td style={{fontFamily: 'monospace', color: 'var(--text-muted)'}}>{q.questionCode || q._id.slice(-6).toUpperCase()}</td>
                        <td>
                          <div style={{fontWeight: 600}}>{q.subject}</div>
                          <div style={{fontSize: 12, color: 'var(--text-muted)'}}>{q.chapter ? `${q.chapter} · ${q.topic}` : q.topic}</div>
                        </td>
                        <td className="qb-question-snippet">
                          <RichQuestionContent content={q.text} />
                        </td>
                        <td>
                          <span className={`qb-badge ${q.difficulty?.toLowerCase() || 'medium'}`}>{q.cetDifficulty || q.difficulty}</span>
                          <div style={{fontSize: 12, marginTop: 4, color: 'var(--text-muted)'}}>+{q.marks} / -{q.negativeMarks}</div>
                        </td>
                        <td><span className="qb-badge easy">{q.isActive ? 'Published' : 'Draft'}</span></td>
                        <td style={{fontSize: 12, color: 'var(--text-muted)'}}>
                          {q.createdAt ? new Date(q.createdAt).toLocaleDateString() : 'N/A'}
                        </td>
                        <td>
                          <div style={{display: 'flex', gap: '4px'}}>
                            <button className="qb-btn-icon" title="Preview" onClick={() => setPreviewQ(q)}><Eye size={18}/></button>
                            <button className="qb-btn-icon" title="Edit" onClick={() => edit(q)}><Edit2 size={18}/></button>
                            <button className="qb-btn-icon" title="Duplicate" onClick={() => duplicate(q)}><Copy size={18}/></button>
                            <button className="qb-btn-icon danger" title="Delete" onClick={() => remove(q._id)}><Trash2 size={18}/></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* ================= ADD QUESTION TAB ================= */}
        {activeTab === 'add' && (
          <motion.div key="add" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <div className="qb-form-container">
              {/* Main Column */}
              <div className="qb-form-main">
                <div className="qb-ai-ribbon">
                  <span style={{fontSize: 14, fontWeight: 600, color: 'var(--primary)', marginRight: 'auto'}}>
                    <Wand2 size={16} style={{display:'inline', verticalAlign:'text-bottom'}}/> AI Copilot Tools:
                  </span>
                  <button className="qb-ai-btn" onClick={() => triggerAI('Question Generator')}><BrainCircuit size={14}/> Generate Question</button>
                  <button className="qb-ai-btn" onClick={() => triggerAI('Grammar Check')}><SpellCheck size={14}/> Improve Grammar</button>
                  <button className="qb-ai-btn" onClick={() => triggerAI('Duplicate Check')}><Layers size={14}/> Detect Duplicates</button>
                </div>

                {/* Section 1: Basic Info */}
                <div className="qb-card">
                  <h3 className="qb-card-title"><BookOpen size={20}/> Basic Information</h3>
                  <div className="qb-form-row" style={{marginBottom: 16}}>
                    <div>
                      <label className="qb-label" htmlFor="question-subject">Subject</label>
                      <select
                        id="question-subject"
                        className="qb-input"
                        value={form.subject}
                        onChange={e => setForm({ ...form, subject: e.target.value, chapter: '', topic: '', subTopic: '' })}
                      >
                        <option value="">Select a subject</option>
                        {form.subject && !chapterCatalog.some(subject => subject.name === form.subject) && (
                          <option value={form.subject}>{form.subject}</option>
                        )}
                        {chapterCatalog.map(subject => <option key={subject.name} value={subject.name}>{subject.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="qb-label" htmlFor="question-chapter">Chapter</label>
                      <select
                        id="question-chapter"
                        className="qb-input"
                        value={form.chapter}
                        disabled={!form.subject}
                        onChange={e => setForm({ ...form, chapter: e.target.value, topic: '', subTopic: '' })}
                      >
                        <option value="">{form.subject ? 'Select a chapter' : 'Select a subject first'}</option>
                        {form.chapter && !formSubjectChapters.some(chapter => chapter.name === form.chapter) && (
                          <option value={form.chapter}>{form.chapter}</option>
                        )}
                        {formSubjectChapters.map(chapter => <option key={chapter.name} value={chapter.name}>{chapter.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="qb-form-row">
                    <div><label className="qb-label">Topic</label><input className="qb-input" value={form.topic} onChange={e=>setForm({...form, topic: e.target.value})}/></div>
                    <div><label className="qb-label">Sub Topic</label><input className="qb-input" value={form.subTopic} onChange={e=>setForm({...form, subTopic: e.target.value})}/></div>
                  </div>
                </div>

                {/* Section 2: Editor */}
                <div className="qb-card">
                  <div style={{display:'flex', justifyContent:'space-between'}}>
                    <h3 className="qb-card-title"><FileText size={20}/> Question Editor</h3>
                    <div style={{display:'flex', gap:8}}>
                      <button className="qb-btn-icon" title="Add Image" onClick={() => imageInputRef?.click()}>
                        <ImageIcon size={18}/>
                      </button>
                      <button className="qb-btn-icon" title="Add Video"><Video size={18}/></button>
                    </div>
                  </div>
                  {uploadingImage && (
                    <div className="qb-image-upload-loader" style={{marginBottom: 12}}>
                      <div className="qb-image-loader-spinner" />
                      <div>
                        <div style={{fontWeight: 700, marginBottom: 4}}>Uploading image…</div>
                        <div style={{fontSize: 12, color: 'var(--text-muted)'}}>Please wait while your pasted image is being attached.</div>
                      </div>
                    </div>
                  )}
                  {form.imageUrl && !uploadingImage && (
                    <div style={{marginBottom: 12, border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: '#fff'}}>
                      <img src={form.imageUrl} alt="Question attachment" style={{maxHeight: 220, width: '100%', objectFit: 'contain', borderRadius: 8}} />
                      <div style={{marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                        <button className="qb-btn qb-btn-outline" type="button" onClick={() => imageInputRef?.click()}>
                          <ImageIcon size={16} style={{marginRight: 6}} /> Change Image
                        </button>
                        <button className="qb-btn qb-btn-outline" type="button" onClick={() => setForm({ ...form, imageUrl: '' })}>
                          <Trash2 size={16} style={{marginRight: 6}} /> Delete Image
                        </button>
                      </div>
                      <div style={{marginTop: 8, fontSize: 12, color: 'var(--text-muted)'}}>Attached image ready to be saved with the question.</div>
                    </div>
                  )}
                  <RichQuestionEditor
                    value={form.text}
                    onChange={text => setForm(current => ({ ...current, text }))}
                    onPasteImage={uploadQuestionImage}
                  />

                  <div className="qb-live-preview">
                    <div style={{fontSize: 12, fontWeight: 700, marginBottom: 10, color: 'var(--text-muted)'}}>Live Preview</div>
                    <div className="qb-preview-text">
                      <RichQuestionContent content={form.text} />
                    </div>
                  </div>

                  <div style={{fontSize: 12, color:'var(--text-muted)', marginTop: 8}}>Word count: {(form.text || '').replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length}</div>
                  
                </div>

                {/* Section 3: Options */}
                <div className="qb-card">
                  <div style={{display:'flex', justifyContent:'space-between'}}>
                    <h3 className="qb-card-title"><Target size={20}/> Options Section</h3>
                    <button className="qb-ai-btn" onClick={() => triggerAI('Distractor Generator')}><BrainCircuit size={14}/> Generate Distractors</button>
                  </div>
                  
                  {(form.options || []).map((opt, i) => (
                    <div key={i} className={`qb-option-block ${form.correctIndex === i ? 'correct' : ''}`} style={form.correctIndex === i ? {borderColor: '#10b981', background: '#f0fdf4'} : {}}>
                      <div className="qb-option-handle"><GripVertical size={18}/></div>
                      <div className="qb-option-input-wrap">
                        <label className="qb-label">Option {String.fromCharCode(65+i)} {form.correctIndex === i && '(Correct Answer)'}</label>
                        <RichQuestionEditor compact value={opt} onChange={value => {
                          const newOpts = [...form.options]; newOpts[i] = value; setForm({...form, options: newOpts})
                        }} onPasteImage={uploadQuestionImage} />
                      </div>
                      <div style={{display:'flex', flexDirection:'column', gap: 8, marginTop: 24}}>
                        <button className="qb-btn-icon" title="Mark as Correct" onClick={() => setForm({...form, correctIndex: i})}>
                          <CheckCircle2 size={20} color={form.correctIndex === i ? '#10b981' : '#cbd5e1'}/>
                        </button>
                        <button className="qb-btn-icon danger" onClick={() => {
                          if ((form.options || []).length <= 2) return showToast('Minimum 2 options required', 'error');
                          const newOpts = (form.options || []).filter((_, idx) => idx !== i);
                          setForm({...form, options: newOpts, correctIndex: 0})
                        }}><Trash2 size={18}/></button>
                      </div>
                    </div>
                  ))}
                  <button className="qb-btn qb-btn-outline" onClick={() => setForm({...form, options: [...(form.options || []), '']})}>
                    <Plus size={16}/> Add Option
                  </button>
                </div>
                
                {/* Section 4: Solution */}
                <div className="qb-card">
                  <h3 className="qb-card-title"><MessageSquare size={20}/> Detailed Solution</h3>
                  <RichQuestionEditor
                    value={form.solution}
                    editorLabel="Detailed solution"
                    placeholder="Paste or write the step-by-step solution here…"
                    onChange={solution => setForm(current => ({ ...current, solution }))}
                    onPasteImage={uploadSolutionImage}
                  />
                  {uploadingSolutionImage && (
                    <div className="qb-image-upload-loader" style={{marginTop: 10}}>
                      <div className="qb-image-loader-spinner" />
                      <div>
                        <div style={{fontWeight: 700, marginBottom: 4}}>Uploading solution image…</div>
                        <div style={{fontSize: 12, color: 'var(--text-muted)'}}>The image will be inserted into the solution after upload.</div>
                      </div>
                    </div>
                  )}
                  <div className="qb-live-preview">
                    <div style={{fontSize: 12, fontWeight: 700, marginBottom: 10, color: 'var(--text-muted)'}}>Solution Preview</div>
                    <FormattedSolution content={form.solution} />
                  </div>
                </div>
              </div>

              {/* Sidebar Column */}
              <div className="qb-form-sidebar">
                <div className="qb-card" style={{padding: 24}}>
                  <h3 className="qb-card-title" style={{fontSize: 16}}><Settings size={18}/> Metadata & Marking</h3>
                  
                  <div className="qb-form-group">
                    <label className="qb-label">Difficulty Level</label>
                    <select className="qb-input" value={form.difficulty} onChange={e=>setForm({...form, difficulty: e.target.value as any})}>
                      <option>Easy</option><option>Medium</option><option>Hard</option>
                    </select>
                  </div>
                  
                  <div className="qb-form-row">
                    <div className="qb-form-group">
                      <label className="qb-label">Marks (+)</label>
                      <input type="number" className="qb-input" value={form.marks} onChange={e=>setForm({...form, marks: Number(e.target.value)})} />
                    </div>
                    <div className="qb-form-group">
                      <label className="qb-label">Negative (-)</label>
                      <input type="number" className="qb-input" value={form.negativeMarks} onChange={e=>setForm({...form, negativeMarks: Number(e.target.value)})} />
                    </div>
                  </div>
                  
                  <div className="qb-form-group">
                    <label className="qb-label">Question Type</label>
                    <select className="qb-input" value={form.qType} onChange={e=>setForm({...form, qType: e.target.value})}>
                      <option>Single Correct</option>
                      <option>Multiple Correct</option>
                      <option>Numerical</option>
                      <option>Matrix Match</option>
                      <option>Assertion Reason</option>
                    </select>
                  </div>
                </div>

                <div className="qb-card" style={{padding: 24}}>
                  <h3 className="qb-card-title" style={{fontSize: 16}}><ShieldCheck size={18}/> Workflow & Visibility</h3>
                  <div className="qb-form-group">
                    <label className="qb-label">Status</label>
                    <select className="qb-input" value={form.status} onChange={e=>setForm({...form, status: e.target.value})}>
                      <option>Draft</option><option>Pending Review</option><option>Published</option><option>Archived</option>
                    </select>
                  </div>
                  <div className="qb-toggle">
                    <span className="qb-toggle-label">Previous Year (PYQ)</span>
                    <input type="checkbox" style={{width: 18, height: 18}} />
                  </div>
                  <div className="qb-toggle">
                    <span className="qb-toggle-label">Institute Only</span>
                    <input type="checkbox" style={{width: 18, height: 18}} defaultChecked />
                  </div>
                </div>
              </div>
            </div>

            {/* Floating Save Bar */}
            <motion.div className="qb-fab" initial={{y: 100}} animate={{y: 0}}>
              <button className="qb-btn qb-btn-outline" onClick={() => setActiveTab('list')}><X size={16}/> Cancel</button>
              <button className="qb-btn qb-btn-primary" onClick={handleSave}><Save size={16}/> {editingId ? 'Update Question' : 'Save Question'}</button>
            </motion.div>
          </motion.div>
        )}

        {/* ================= BULK UPLOAD TAB ================= */}
        {activeTab === 'bulk' && (
          <motion.div key="bulk" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            {showNotesGenerator ? (
              <AiNotesQuestionGenerator
                onClose={() => setShowNotesGenerator(false)}
                onCreateTest={onCreateTest}
              />
            ) : pdfStage === 'review' ? (
              <PdfImportReview
                questions={pdfQuestions}
                meta={pdfMeta}
                importing={importingPdf}
                onChange={setPdfQuestions}
                onImport={handlePdfImport}
                onCancel={resetPdfReview}
              />
            ) : (
            <div className="qb-card" style={{maxWidth: 800, margin: '0 auto', textAlign: 'center', padding: '60px 40px'}}>
              <div style={{width: 80, height: 80, borderRadius: '50%', background: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px'}}>
                <Upload size={40} />
              </div>
              <h2 style={{fontSize: 24, fontWeight: 700, marginBottom: 12}}>Bulk Import Questions</h2>
              <p style={{color: 'var(--text-muted)', marginBottom: 32}}>Import existing questions, extract a PDF question paper, or generate new MCQs from course notes. Everything is reviewed here before it reaches the same question bank.</p>

              <div className="qb-import-formats">
                <button className="qb-import-format" onClick={handleBulkImportClick} type="button">
                  <FileSpreadsheet size={26} />
                  <strong>Excel / CSV / JSON</strong>
                  <span>.xlsx · .xls · .csv · .json</span>
                  <em>Instant import with row-level validation</em>
                </button>
                <button className="qb-import-format" onClick={handlePdfImportClick} type="button">
                  <FileText size={26} />
                  <strong>PDF Question Paper</strong>
                  <span>.pdf · text layer or scanned (OCR)</span>
                  <em>Extract → review → import</em>
                </button>
                <button className="qb-import-format qb-import-format-ai" onClick={() => setShowNotesGenerator(true)} type="button">
                  <BrainCircuit size={26} />
                  <strong>Generate from Notes</strong>
                  <span>.pdf · .pptx</span>
                  <em>Understand topics → generate → review → save</em>
                </button>
              </div>

              <div
                className="qb-dropzone"
                style={{border: '2px dashed var(--border)', borderRadius: 'var(--radius-lg)', padding: '40px 20px', margin: '24px 0', cursor: 'pointer', background: '#fafafa'}}
                onClick={handleBulkImportClick}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleBulkDrop}
              >
                <p style={{fontWeight: 600, color: 'var(--primary)'}}>Click to browse or drag and drop files here</p>
                <p style={{fontSize: 13, color: 'var(--text-muted)', marginTop: 8}}>Supports .csv, .xlsx, .xls, .json and .pdf (Max 25MB for PDF)</p>
                {uploading && <p style={{marginTop: 16, color: 'var(--primary)'}}>Uploading and importing questions…</p>}
                {pdfStage === 'working' && (
                  <div className="qb-pdf-progress">
                    <p style={{marginTop: 16, color: 'var(--primary)'}}>{pdfStatus}</p>
                    <div className="qb-pdf-progress-track"><div className="qb-pdf-progress-fill" /></div>
                  </div>
                )}
                {!uploading && uploadResult && (
                  <div style={{marginTop: 16, textAlign: 'left', color: 'var(--text-main)'}}>
                    <p><strong>Imported:</strong> {uploadResult.imported} / {uploadResult.total}</p>
                    {uploadResult.errors.length > 0 && (
                      <div>
                        <p><strong>Errors:</strong></p>
                        <ul style={{margin: 0, paddingLeft: 20, color: '#ef4444'}}>
                          {uploadResult.errors.slice(0, 3).map((err, idx) => (
                            <li key={idx}>{err.row ? `Row ${err.row}: ` : ''}{err.message}</li>
                          ))}
                          {uploadResult.errors.length > 3 && <li>...and {uploadResult.errors.length - 3} more</li>}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {!uploading && uploadError && (
                  <div style={{marginTop: 16, textAlign: 'left', color: '#b91c1c', background: '#fee2e2', borderRadius: 12, padding: 16}}>
                    <p style={{margin: 0, fontWeight: 700}}>Upload failed:</p>
                    <p style={{margin: '8px 0 0'}}>{uploadError.message}</p>
                    {uploadError.details && (
                      <pre style={{whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 8, fontSize: 12, color: '#991b1b'}}>{JSON.stringify(uploadError.details, null, 2)}</pre>
                    )}
                  </div>
                )}
                {!uploading && pdfStage !== 'working' && pdfError && (
                  <div style={{marginTop: 16, textAlign: 'left', color: '#b91c1c', background: '#fee2e2', borderRadius: 12, padding: 16}}>
                    <p style={{margin: 0, fontWeight: 700}}>PDF extraction failed:</p>
                    <p style={{margin: '8px 0 0'}}>{pdfError.message}</p>
                  </div>
                )}
              </div>

              <div style={{display: 'flex', gap: 16, justifyContent: 'center'}}>
                <button className="qb-btn qb-btn-outline" onClick={downloadCSV}><Download size={16}/> Download CSV Template</button>
                <button className="qb-btn qb-btn-outline" onClick={handleDownloadPDF}><ShieldCheck size={16}/> View Validation Rules</button>
              </div>
            </div>
            )}
          </motion.div>
        )}

      </AnimatePresence>

      {/* Preview Drawer */}
      <AnimatePresence>
        {previewQ && (
          <div className="qb-drawer-overlay" onClick={() => setPreviewQ(null)}>
            <motion.div className="qb-drawer" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} onClick={e => e.stopPropagation()}>
              <div className="qb-drawer-header">
                <h3 style={{fontWeight: 700, fontSize: 18}}>Question Preview</h3>
                <button className="qb-btn-icon" onClick={() => setPreviewQ(null)}><X size={20}/></button>
              </div>
              <div className="qb-drawer-content">
                <div style={{display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap'}}>
                  <span className="qb-badge medium">{previewQ.subject}</span>
                  {previewQ.chapter && <span className="qb-badge easy">{previewQ.chapter}</span>}
                  {previewQ.subTopic && <span className="qb-badge easy">{previewQ.subTopic}</span>}
                  <span className={`qb-badge ${previewQ.difficulty?.toLowerCase() || 'medium'}`}>{previewQ.cetDifficulty || previewQ.difficulty}</span>
                </div>
                
                <div className="qb-preview-text"><RichQuestionContent content={previewQ.text} /></div>
                {previewQ.imageUrl && (
                  <div style={{marginTop: 18, borderRadius: 12, overflow: 'hidden', background: '#fff', border: '1px solid var(--border)'}}>
                    <img src={previewQ.imageUrl} alt="Question preview" style={{width: '100%', maxHeight: 280, objectFit: 'contain', display: 'block'}} />
                  </div>
                )}
                
                <div>
                  {previewQ.options.map((opt, i) => (
                    <div key={i} className={`qb-preview-option ${previewQ.correctIndex === i ? 'correct' : ''}`}>
                      <div style={{width: 24, height: 24, borderRadius: '50%', background: previewQ.correctIndex === i ? '#10b981' : '#e2e8f0', color: previewQ.correctIndex === i ? '#fff' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700}}>
                        {String.fromCharCode(65+i)}
                      </div>
                      <div><RichQuestionContent content={opt} /></div>
                      {previewQ.correctIndex === i && <CheckCircle2 size={18} color="#10b981" style={{marginLeft: 'auto'}}/>}
                    </div>
                  ))}
                </div>

                <div style={{marginTop: 32, paddingTop: 32, borderTop: '1px solid var(--border)'}}>
                  <h4 style={{fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8}}><Settings size={18}/> Metadata</h4>
                  <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 14}}>
                    <div><span style={{color: 'var(--text-muted)'}}>Marks:</span> <span style={{fontWeight: 600}}>+{previewQ.marks} / -{previewQ.negativeMarks}</span></div>
                    <div><span style={{color: 'var(--text-muted)'}}>Status:</span> <span style={{fontWeight: 600}}>{previewQ.isActive ? 'Published' : 'Draft'}</span></div>
                    <div><span style={{color: 'var(--text-muted)'}}>Created:</span> <span style={{fontWeight: 600}}>{previewQ.createdAt ? new Date(previewQ.createdAt).toLocaleDateString() : 'N/A'}</span></div>
                    <div><span style={{color: 'var(--text-muted)'}}>Usage:</span> <span style={{fontWeight: 600}}>0 Tests</span></div>
                  </div>
                </div>
                {previewQ.solution && (
                  <div style={{marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--border)'}}>
                    <h4 style={{fontWeight: 700, marginBottom: 12}}>Detailed Solution</h4>
                    <FormattedSolution content={previewQ.solution} />
                  </div>
                )}
              </div>
              <div style={{padding: 24, borderTop: '1px solid var(--border)', display: 'flex', gap: 12, background: 'var(--bg-main)'}}>
                <button className="qb-btn qb-btn-primary" style={{flex: 1}} onClick={() => { setPreviewQ(null); edit(previewQ) }}><Edit2 size={16}/> Edit Question</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toasts */}
      <div className="qb-toast-container">
        <AnimatePresence>
          {toast && (
            <motion.div initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, scale: 0.9}} className={`qb-toast ${toast.type}`}>
              {toast.type === 'success' ? <CheckCircle2 size={18} color="#10b981"/> : <AlertCircle size={18} color="#ef4444"/>}
              {toast.msg}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  )
}