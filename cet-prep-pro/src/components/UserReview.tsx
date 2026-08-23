import { useState, useMemo } from 'react'

interface Student {
  id: string
  name: string
  email: string
  date: string
  exam: string
  status: 'Pending Verification' | 'Uploaded' | 'Incomplete'
  image?: string
}

const INITIAL_STUDENTS: Student[] = [
  {
    id: '#CET-9842',
    name: 'Aditya Sharma',
    email: 'aditya.s@outlook.com',
    date: 'Oct 12, 2023',
    exam: 'MHT-CET 2025',
    status: 'Pending Verification',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDmMny3MWOLp7I6B06eGnO_5IHDmtgKhbsDz6XRffLzitYG6i-0bQ-CUr131LLq7Ro_h6Mteq1kM6QhhPXDP64oNm3nXFnA-QgP2gSOhsEtce11SfE6qXEH263keVDagRwa7bE4KRdUh8sYI3soSTwjmQOGEv7eBMOFQ7zS-D-23UkMKBrVBjR3px6KgHQNSkrmNrPd-VY1e96vULy15AXx5bfX2p2RZPLmOwoHO1XisSHTibu6cG0C9_iJSAFjEKRm59x-ef5cgJQ'
  },
  {
    id: '#CET-7721',
    name: 'Priya Deshmukh',
    email: 'p.desh2025@gmail.com',
    date: 'Oct 14, 2023',
    exam: 'MHT-CET 2025',
    status: 'Uploaded',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBHY0VAURSu3SG-zep9cYKfrTI2V54R7-VTNaBflXGD_n4qskhEGQ2zKdgJJaqwEAMuKdaZtdqTeRBcLiAz6N_woLY-WD8tToefEgL1zvswksrP5BDr_ofC4b8zEi4mUv-ECT7CD42Oq-iHj2GGV1HFwoEPBQrwNfgo8cFi4ymFCyIDVAkORrzS9XrVattVS7D8jx-v2YWtDqKufAYlRj7Pe7pzNRp_5Ay-PTzDIvelykjbnGg0qwr9JlvJNqNxA7n_ax2Kgf-K_1A'
  },
  {
    id: '#CET-1102',
    name: 'Rahul Kulkarni',
    email: 'rahulk_official@live.com',
    date: 'Oct 15, 2023',
    exam: 'MHT-CET 2024',
    status: 'Incomplete'
  },
  {
    id: '#CET-6610',
    name: 'Snehal Patil',
    email: 'patil.snehal@edu.in',
    date: 'Oct 15, 2023',
    exam: 'MHT-CET 2025',
    status: 'Pending Verification',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBe2vh1y-9vExXKBG1BcT_WTd_Z8q_0_cf3OMxH6pLUsag0gFa6Aq5rnmRU-Dt6ZK9bwQlXJ7EYuL-EOENoPouC4CYRDGablTfxshCem-3q750O4oEbWp-po9B7kWk3EQw3SQWovO-5RffHfiz3m7EcPKLTyi7JzMPVmyxVWEVH7yq7LQLjRUJpiJ0Ra8u1UC7QsIPt8qHkDqcTChmbl1_gnb7tFm41QHl-4A4lFTRXvvVnLeLRiZ6-vpWB6t-SYd2FbFM1u2saAew'
  }
]

export default function UserReview() {
  const [students, setStudents] = useState<Student[]>(INITIAL_STUDENTS)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [examFilter, setExamFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  
  // Custom stats
  const [pendingCount, setPendingCount] = useState(1284)
  const [approvedCount, setApprovedCount] = useState(452)
  const [flaggedCount, setFlaggedCount] = useState(18)

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredStudents.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredStudents.map(s => s.id)))
    }
  }

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setSelectedIds(next)
  }

  const handleApprove = (id: string) => {
    setStudents(prev =>
      prev.map(s => {
        if (s.id === id && s.status !== 'Uploaded') {
          // Adjust stats
          if (s.status === 'Pending Verification') {
            setPendingCount(c => c - 1)
          } else if (s.status === 'Incomplete') {
            setFlaggedCount(c => c - 1)
          }
          setApprovedCount(c => c + 1)
          return { ...s, status: 'Uploaded' }
        }
        return s
      })
    )
  }

  const handleReject = (id: string) => {
    setStudents(prev =>
      prev.map(s => {
        if (s.id === id && s.status !== 'Incomplete') {
          // Adjust stats
          if (s.status === 'Pending Verification') {
            setPendingCount(c => c - 1)
          } else if (s.status === 'Uploaded') {
            setApprovedCount(c => c - 1)
          }
          setFlaggedCount(c => c + 1)
          return { ...s, status: 'Incomplete' }
        }
        return s
      })
    )
  }

  const handleBulkApprove = () => {
    let approvedAny = false
    setStudents(prev =>
      prev.map(s => {
        if (selectedIds.has(s.id) && s.status !== 'Uploaded') {
          if (s.status === 'Pending Verification') {
            setPendingCount(c => c - 1)
          } else if (s.status === 'Incomplete') {
            setFlaggedCount(c => c - 1)
          }
          setApprovedCount(c => c + 1)
          approvedAny = true
          return { ...s, status: 'Uploaded' }
        }
        return s
      })
    )
    if (approvedAny) {
      setSelectedIds(new Set())
    }
  }

  const handleBulkReject = () => {
    let rejectedAny = false
    setStudents(prev =>
      prev.map(s => {
        if (selectedIds.has(s.id) && s.status !== 'Incomplete') {
          if (s.status === 'Pending Verification') {
            setPendingCount(c => c - 1)
          } else if (s.status === 'Uploaded') {
            setApprovedCount(c => c - 1)
          }
          setFlaggedCount(c => c + 1)
          rejectedAny = true
          return { ...s, status: 'Incomplete' }
        }
        return s
      })
    )
    if (rejectedAny) {
      setSelectedIds(new Set())
    }
  }

  // Filter students based on query and selections
  const filteredStudents = useMemo(() => {
    return students.filter(student => {
      const matchesSearch =
        student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        student.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        student.id.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesExam = examFilter === 'All' || student.exam === examFilter
      const matchesStatus = statusFilter === 'All' || student.status === statusFilter

      return matchesSearch && matchesExam && matchesStatus
    })
  }, [students, searchQuery, examFilter, statusFilter])

  return (
    <div className="space-y-8 p-1">
      {/* Search Header for Mobile / Tablet (Optional block mirroring topbar integration) */}
      <div className="md:hidden flex items-center bg-white p-3 rounded-xl shadow-sm border border-slate-200">
        <span className="material-symbols-outlined text-slate-400 mr-2">search</span>
        <input
          className="w-full bg-transparent border-none outline-none text-sm"
          placeholder="Search applicants..."
          type="text"
          value={searchQuery}
          onChange={handleSearchChange}
        />
      </div>

      {/* Registration Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-6 rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 flex items-center gap-4 bg-white/70 backdrop-blur-md border border-white/40">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
            <span className="material-symbols-outlined text-[32px]">pending_actions</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Pending</p>
            <h3 className="text-2xl font-bold text-slate-800">{pendingCount.toLocaleString()}</h3>
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 flex items-center gap-4 bg-white/70 backdrop-blur-md border border-white/40">
          <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center text-green-600">
            <span className="material-symbols-outlined text-[32px]">verified</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Approved Today</p>
            <h3 className="text-2xl font-bold text-slate-800">{approvedCount.toLocaleString()}</h3>
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 flex items-center gap-4 bg-white/70 backdrop-blur-md border border-white/40">
          <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-red-600">
            <span className="material-symbols-outlined text-[32px]">report_problem</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Flagged/Rejected</p>
            <h3 className="text-2xl font-bold text-slate-800">{flaggedCount.toLocaleString()}</h3>
          </div>
        </div>
      </div>

      {/* Filters & Bulk Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <select
              className="appearance-none pl-3 pr-8 py-2 bg-slate-50 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 outline-none focus:border-blue-500 cursor-pointer"
              value={examFilter}
              onChange={(e) => setExamFilter(e.target.value)}
            >
              <option value="All">All Exams</option>
              <option value="MHT-CET 2025">MHT-CET 2025</option>
              <option value="MHT-CET 2024">MHT-CET 2024</option>
            </select>
            <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none text-[18px]">expand_more</span>
          </div>

          <div className="relative">
            <select
              className="appearance-none pl-3 pr-8 py-2 bg-slate-50 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 outline-none focus:border-blue-500 cursor-pointer"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="All">All Statuses</option>
              <option value="Pending Verification">Pending Verification</option>
              <option value="Uploaded">Uploaded</option>
              <option value="Incomplete">Incomplete</option>
            </select>
            <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none text-[18px]">expand_more</span>
          </div>
          
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
            >
              Clear Search "{searchQuery}"
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleBulkReject}
            disabled={selectedIds.size === 0}
            className={`px-4 py-2 border rounded-xl font-semibold text-sm flex items-center gap-2 transition-all ${
              selectedIds.size > 0
                ? 'border-red-200 text-red-600 hover:bg-red-50 cursor-pointer'
                : 'border-slate-100 text-slate-300 cursor-not-allowed'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">block</span>
            Bulk Reject ({selectedIds.size})
          </button>
          <button
            onClick={handleBulkApprove}
            disabled={selectedIds.size === 0}
            className={`px-4 py-2 rounded-xl font-semibold text-sm flex items-center gap-2 transition-all shadow-sm ${
              selectedIds.size > 0
                ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer shadow-blue-200'
                : 'bg-slate-100 text-slate-300 cursor-not-allowed'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">check_circle</span>
            Bulk Approve ({selectedIds.size})
          </button>
        </div>
      </div>

      {/* Data Table Section */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-slate-150">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/70 text-slate-500 border-b border-slate-100">
                <th className="p-4 w-10">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer w-4 h-4"
                    checked={filteredStudents.length > 0 && selectedIds.size === filteredStudents.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="p-4 font-semibold text-[11px] uppercase tracking-wider">Student Name</th>
                <th className="p-4 font-semibold text-[11px] uppercase tracking-wider">Email Address</th>
                <th className="p-4 font-semibold text-[11px] uppercase tracking-wider">Reg. Date</th>
                <th className="p-4 font-semibold text-[11px] uppercase tracking-wider">Target Exam</th>
                <th className="p-4 font-semibold text-[11px] uppercase tracking-wider">Doc Status</th>
                <th className="p-4 font-semibold text-[11px] uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400 text-sm">
                    No applicants found matching the filters or query.
                  </td>
                </tr>
              ) : (
                filteredStudents.map(student => (
                  <tr
                    key={student.id}
                    className={`hover:bg-slate-50/50 transition-colors duration-150 ${
                      student.status === 'Incomplete' ? 'bg-red-50/10' : ''
                    }`}
                  >
                    <td className="p-4">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer w-4 h-4"
                        checked={selectedIds.has(student.id)}
                        onChange={() => toggleSelect(student.id)}
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-bold overflow-hidden flex-shrink-0">
                          {student.image ? (
                            <img className="w-full h-full object-cover" src={student.image} alt={student.name} />
                          ) : (
                            <span className="material-symbols-outlined text-[20px]">person</span>
                          )}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800 text-sm">{student.name}</p>
                          <p className="text-xs text-slate-400">ID: {student.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-sm text-slate-600">{student.email}</td>
                    <td className="p-4 text-sm text-slate-500">{student.date}</td>
                    <td className="p-4">
                      <span className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded text-xs font-semibold">
                        {student.exam}
                      </span>
                    </td>
                    <td className="p-4">
                      {student.status === 'Pending Verification' && (
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full w-fit border border-amber-200/40">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                          Pending Verification
                        </span>
                      )}
                      {student.status === 'Uploaded' && (
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600 bg-green-50 px-2.5 py-1 rounded-full w-fit border border-green-200/40">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                          Uploaded
                        </span>
                      )}
                      {student.status === 'Incomplete' && (
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-red-600 bg-red-50 px-2.5 py-1 rounded-full w-fit border border-red-200/40">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                          Incomplete
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1">
                        <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all" title="View Details">
                          <span className="material-symbols-outlined text-[20px]">visibility</span>
                        </button>
                        <button
                          onClick={() => handleApprove(student.id)}
                          disabled={student.status === 'Uploaded'}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            student.status === 'Uploaded'
                              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                              : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm cursor-pointer'
                          }`}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(student.id)}
                          disabled={student.status === 'Incomplete'}
                          className={`p-2 rounded-lg transition-all ${
                            student.status === 'Incomplete'
                              ? 'text-slate-300 cursor-not-allowed'
                              : 'text-red-500 hover:bg-red-50 cursor-pointer'
                          }`}
                          title="Reject"
                        >
                          <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
          <p className="text-xs text-slate-500">
            Showing 1 to {filteredStudents.length} of {filteredStudents.length} filtered ({students.length} total applicants)
          </p>
          <div className="flex items-center gap-1">
            <button className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:bg-white transition-colors cursor-pointer" disabled>
              <span className="material-symbols-outlined text-[20px]">chevron_left</span>
            </button>
            <button className="w-8 h-8 rounded-lg bg-blue-600 text-white text-xs font-semibold">1</button>
            <button className="w-8 h-8 rounded-lg text-slate-500 hover:bg-white border border-transparent hover:border-slate-200 text-xs font-semibold cursor-pointer">2</button>
            <button className="w-8 h-8 rounded-lg text-slate-500 hover:bg-white border border-transparent hover:border-slate-200 text-xs font-semibold cursor-pointer">3</button>
            <span className="px-1 text-slate-400 text-xs font-semibold">...</span>
            <button className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:bg-white transition-colors cursor-pointer">
              <span className="material-symbols-outlined text-[20px]">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* Contextual Help / Tips for Admins */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-panel p-5 rounded-2xl border-l-4 border-blue-600 shadow-sm bg-white border border-slate-100">
          <h4 className="font-semibold text-blue-700 text-sm mb-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">info</span>
            Verification Guideline
          </h4>
          <p className="text-sm text-slate-600 leading-relaxed">
            Ensure the uploaded document shows a clear 10th or 12th standard mark sheet with a visible birth date. Flag users with blurred uploads for re-submission.
          </p>
        </div>
        <div className="glass-panel p-5 rounded-2xl border-l-4 border-indigo-500 shadow-sm bg-white border border-slate-100">
          <h4 className="font-semibold text-indigo-700 text-sm mb-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">auto_fix_high</span>
            AI Pre-Verification
          </h4>
          <p className="text-sm text-slate-600 leading-relaxed">
            Users with the green <span className="text-green-600 font-bold">Uploaded</span> badge have passed initial AI document scanning for name-to-profile matches.
          </p>
        </div>
      </div>

      {/* Floating Quick Add Button */}
      <div className="fixed bottom-10 right-10 z-50">
        <button
          onClick={() => {
            // Interactive action: append a dummy student
            const dummyNames = ['Rohan Joshi', 'Neha Deshpande', 'Vikram Shinde', 'Tanvi Mahajan']
            const dummyEmails = ['rohan.j@gmail.com', 'neha.d@yahoo.com', 'vikram.s@outlook.com', 'tanvi.m@gmail.com']
            const randomIndex = Math.floor(Math.random() * dummyNames.length)
            const idNumber = Math.floor(Math.random() * 9000) + 1000
            
            const newStudent: Student = {
              id: `#CET-${idNumber}`,
              name: dummyNames[randomIndex],
              email: dummyEmails[randomIndex],
              date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
              exam: 'MHT-CET 2025',
              status: 'Pending Verification'
            }
            
            setStudents(prev => [newStudent, ...prev])
            setPendingCount(c => c + 1)
          }}
          className="w-14 h-14 rounded-full bg-indigo-600 text-white shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all duration-200 ring-4 ring-white cursor-pointer"
          title="Add New Applicant Mock"
        >
          <span className="material-symbols-outlined text-[32px]">person_add</span>
        </button>
      </div>
    </div>
  )
}
