// src/App.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { 
  Plus, Upload, Download, FileText, Loader2, LogOut, Lock, Mail, X, 
  Info, Trash2, Search, Sun, Moon, CloudLightning, CloudCheck, Eye, 
  FileSpreadsheet, ChevronLeft, ChevronRight, User, Settings, Camera, Sparkles
} from 'lucide-react';

export default function App() {
  const [session, setSession] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  
  const [topics, setTopics] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadingInModal, setUploadingInModal] = useState(false);
  const [aiGeneratingId, setAiGeneratingId] = useState(null);
  const [syncStatus, setSyncStatus] = useState('synced');

  // Server-Side Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const ITEMS_PER_PAGE = 8;

  const [isMobile, setIsMobile] = useState(false);

  // Profile Management States
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [updatingProfile, setUpdatingProfile] = useState(false);

  // Add Entry Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newFile, setNewFile] = useState(null);
  const [isCreatingEntry, setIsCreatingEntry] = useState(false);

  // Detailed Record Inspection View State
  const [selectedRecord, setSelectedRecord] = useState(null);

  // NEW: Active File Document Inline Reader Preview State
  const [activePreviewFile, setActivePreviewFile] = useState(null);

  const timersRef = useRef({});
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme-preference');
    return saved ? saved === 'dark' : false;
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfileData(session.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadProfileData(session.user);
    });
    
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('resize', handleResize);
      Object.values(timersRef.current).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (session) {
      fetchTopics();
    }
  }, [session, currentPage, searchQuery]);

  useEffect(() => {
    localStorage.setItem('theme-preference', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const loadProfileData = (user) => {
    const meta = user.user_metadata || {};
    setUsername(meta.username || user.email.split('@')[0]);
    setAvatarUrl(meta.avatar_url || '');
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    if (isRegistering) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) alert(error.message);
      else alert('Account setup finished! Try signing into your space.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
    }
    setAuthLoading(false);
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setUpdatingProfile(true);
    const { data, error } = await supabase.auth.updateUser({
      data: { username: username, avatar_url: avatarUrl }
    });
    if (error) alert('Failed updating identity: ' + error.message);
    else {
      setSession(prev => ({ ...prev, user: data.user }));
      setShowProfileModal(false);
    }
    setUpdatingProfile(false);
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !session) return;

    setUpdatingProfile(true);
    const fileExt = file.name.split('.').pop();
    const filePath = `avatars/${session.user.id}-${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage.from('knowledge-files').upload(filePath, file);
    if (uploadError) {
      alert('Avatar upload failed: ' + uploadError.message);
      setUpdatingProfile(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from('knowledge-files').getPublicUrl(filePath);
    setAvatarUrl(publicUrl);
    setUpdatingProfile(false);
  };

  const fetchTopics = async () => {
    setLoading(true);
    const fromIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const toIndex = fromIndex + ITEMS_PER_PAGE - 1;

    let baseQuery = supabase
      .from('topics')
      .select('*', { count: 'exact' })
      .eq('user_id', session.user.id);

    if (searchQuery.trim() !== '') {
      baseQuery = baseQuery.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
    }

    const { data, error, count } = await baseQuery
      .order('created_at', { ascending: false })
      .range(fromIndex, toIndex);
    
    if (!error) {
      setTopics(data || []);
      setTotalCount(count || 0);

      if (selectedRecord) {
        const matchingRecord = data.find(r => r.id === selectedRecord.id);
        if (matchingRecord) setSelectedRecord(matchingRecord);
      }
    }
    setLoading(false);
  };

  const parseFilesList = (record) => {
    if (!record || !record.file_url) return [];
    try {
      if (record.file_url.startsWith('[')) {
        return JSON.parse(record.file_url);
      }
    } catch (e) {
      console.warn("Falling back to single file parse");
    }
    return [{ name: record.file_name || 'Attached Document', url: record.file_url }];
  };

  // Helper method to resolve browser viewability vectors
  const getFileCategory = (filename) => {
    if (!filename) return 'other';
    const ext = filename.split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
    if (['pdf', 'txt', 'md', 'json'].includes(ext)) return 'viewable-doc';
    return 'other';
  };

  const runAiDescriptionGeneration = async (id, fileName) => {
    setAiGeneratingId(id);
    setSyncStatus('saving');
    
    await new Promise(resolve => setTimeout(resolve, 1200));
    const cleanName = fileName.split('.')[0].replace(/[-_]/g, ' ');
    const aiGeneratedText = `Automated breakdown analysis for "${cleanName}". Operational parameters checked and synchronized across platform document pipelines.`;

    const { error } = await supabase.from('topics').update({ description: aiGeneratedText }).eq('id', id);
    if (!error) {
      setTopics(prev => prev.map(t => t.id === id ? { ...t, description: aiGeneratedText } : t));
      setSelectedRecord(prev => prev && prev.id === id ? { ...prev, description: aiGeneratedText } : prev);
      setSyncStatus('synced');
    } else {
      setSyncStatus('error');
    }
    setAiGeneratingId(null);
  };

  const handleCreateNewEntry = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return alert('Please provide a title.');
    
    setIsCreatingEntry(true);
    setSyncStatus('saving');

    let finalFileValue = null;
    let finalFileNameValue = null;

    try {
      if (newFile) {
        const fileExt = newFile.name.split('.').pop();
        const generatedStorageName = `${session.user.id}-${Math.random()}.${fileExt}`;
        const filePath = `uploads/${generatedStorageName}`;

        const { error: uploadError } = await supabase.storage.from('knowledge-files').upload(filePath, newFile);
        if (uploadError) throw new Error('File upload failure: ' + uploadError.message);

        const { data: { publicUrl } } = supabase.storage.from('knowledge-files').getPublicUrl(filePath);
        
        finalFileValue = JSON.stringify([{ name: newFile.name, url: publicUrl }]);
        finalFileNameValue = newFile.name;
      }

      const savedDescription = newDescription.trim() || (newFile ? `Automated breakdown analysis for "${newFile.name.split('.')[0]}".` : '');

      const { error: insertError } = await supabase
        .from('topics')
        .insert([{ 
          title: newTitle, 
          description: savedDescription, 
          file_url: finalFileValue, 
          file_name: finalFileNameValue, 
          user_id: session.user.id 
        }]);

      if (insertError) throw insertError;

      setNewTitle('');
      setNewDescription('');
      setNewFile(null);
      setShowAddModal(false);
      setSyncStatus('synced');
      fetchTopics();

    } catch (err) {
      console.error(err);
      setSyncStatus('error');
      alert(err.message);
    } finally {
      setIsCreatingEntry(false);
    }
  };

  const handleDeleteRow = async (id, e) => {
    if (e) e.stopPropagation();
    if (confirm('Are you sure you want to permanently delete this topic entry?')) {
      const { error } = await supabase.from('topics').delete().eq('id', id);
      if (!error) {
        if (selectedRecord && selectedRecord.id === id) setSelectedRecord(null);
        if (topics.length === 1 && currentPage > 1) {
          setCurrentPage(currentPage - 1);
        } else {
          fetchTopics();
        }
      } else {
        alert('Could not delete data row: ' + error.message);
      }
    }
  };

  const executeAutoSave = useCallback(async (id, fieldName, value) => {
    setSyncStatus('saving');
    const { error } = await supabase.from('topics').update({ [fieldName]: value }).eq('id', id);
    if (!error) {
      setSyncStatus('synced');
      setTopics(prev => prev.map(t => t.id === id ? { ...t, [fieldName]: value } : t));
    } else {
      setSyncStatus('error');
    }
  }, []);

  const handleFieldChange = (id, fieldName, value) => {
    if (selectedRecord && selectedRecord.id === id) {
      setSelectedRecord(prev => ({ ...prev, [fieldName]: value }));
    }
    setTopics(prevTopics => prevTopics.map(t => t.id === id ? { ...t, [fieldName]: value } : t));
    
    setSyncStatus('saving');
    const timerKey = `${id}-${fieldName}`;
    if (timersRef.current[timerKey]) clearTimeout(timersRef.current[timerKey]);
    timersRef.current[timerKey] = setTimeout(() => {
      executeAutoSave(id, fieldName, value);
      delete timersRef.current[timerKey];
    }, 600);
  };

  const handleModalAppendFile = async (e, record) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingInModal(true);
    setSyncStatus('saving');

    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `uploads/${record.id}-${Math.random()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage.from('knowledge-files').upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('knowledge-files').getPublicUrl(filePath);
      
      const currentFiles = parseFilesList(record);
      const updatedFilesList = [...currentFiles, { name: file.name, url: publicUrl }];
      const packedJsonString = JSON.stringify(updatedFilesList);

      const { error: updateError } = await supabase
        .from('topics')
        .update({ file_url: packedJsonString, file_name: file.name })
        .eq('id', record.id);

      if (updateError) throw updateError;

      setTopics(topics.map(t => t.id === record.id ? { ...t, file_url: packedJsonString, file_name: file.name } : t));
      setSelectedRecord(prev => prev ? { ...prev, file_url: packedJsonString, file_name: file.name } : null);
      setSyncStatus('synced');

      if (!record.description || record.description.trim() === '') {
        await runAiDescriptionGeneration(record.id, file.name);
      }

    } catch (err) {
      alert('File registration failed: ' + err.message);
      setSyncStatus('error');
    } finally {
      setUploadingInModal(false);
      e.target.value = '';
    }
  };

  const handleModalDeleteFile = async (fileIndex, record) => {
    if (!confirm('Are you sure you want to decouple this file from the record?')) return;
    
    const currentFiles = parseFilesList(record);
    const updatedFilesList = currentFiles.filter((_, idx) => idx !== fileIndex);
    
    const packedJsonString = updatedFilesList.length > 0 ? JSON.stringify(updatedFilesList) : null;
    const plainNameValue = updatedFilesList.length > 0 ? updatedFilesList[updatedFilesList.length - 1].name : null;

    setSyncStatus('saving');
    const { error } = await supabase.from('topics').update({ file_url: packedJsonString, file_name: plainNameValue }).eq('id', record.id);
    
    if (!error) {
      setTopics(topics.map(t => t.id === record.id ? { ...t, file_url: packedJsonString, file_name: plainNameValue } : t));
      setSelectedRecord(prev => prev ? { ...prev, file_url: packedJsonString, file_name: plainNameValue } : null);
      if (activePreviewFile && currentFiles[fileIndex].url === activePreviewFile.url) {
        setActivePreviewFile(null);
      }
      setSyncStatus('synced');
    } else {
      setSyncStatus('error');
    }
  };

  const handleExportCSV = async () => {
    const { data, error } = await supabase.from('topics').select('*').eq('user_id', session.user.id);
    if (error || !data || data.length === 0) return alert('No rows are currently available to export.');
    
    const headers = ['Title', 'Description', 'File Payload Records Summary'];
    const rows = data.map(t => [
      `"${(t.title || '').replace(/"/g, '""')}"`,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      `"${(t.file_url || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `knowledge_complete_backup.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      setSyncStatus('saving');
      try {
        const text = evt.target.result;
        const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
        if (lines.length <= 1) return alert('Spreadsheet contains zero records.');

        const parsedRecords = lines.slice(1).map(line => {
          const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || line.split(',');
          const clean = (val) => val ? val.replace(/^"|"$/g, '').replace(/""/g, '"').trim() : '';
          return {
            title: clean(matches[0]),
            description: clean(matches[1]),
            file_url: clean(matches[2]) || null,
            file_name: clean(matches[2]) ? 'Imported Files Map' : null,
            user_id: session.user.id
          };
        });

        const { error } = await supabase.from('topics').insert(parsedRecords);
        if (error) throw error;

        fetchTopics();
        setSyncStatus('synced');
        alert('Successfully uploaded dataset entries!');
      } catch (err) {
        console.error(err);
        setSyncStatus('error');
        alert('Failed parsing spreadsheet: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE) || 1;

  const theme = {
    bg: darkMode ? 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' : 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
    cardBg: darkMode ? 'rgba(30, 41, 59, 0.85)' : 'rgba(255, 255, 255, 0.8)',
    tableBg: darkMode ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
    thBg: darkMode ? '#1e293b' : '#f8fafc',
    thText: darkMode ? '#94a3b8' : '#475569',
    tdText: darkMode ? '#cbd5e1' : '#334155',
    inputBg: darkMode ? '#0f172a' : '#f8fafc',
    inputBorder: darkMode ? '#334155' : '#cbd5e1',
    inputText: darkMode ? '#ffffff' : '#0f172a',
    border: darkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.5)',
    mainTitle: darkMode ? '#ffffff' : '#0f172a',
    subText: darkMode ? '#94a3b8' : '#64748b',
    interactiveBg: darkMode ? '#1e293b' : '#f1f5f9',
    interactiveBorder: darkMode ? '#334155' : '#e2e8f0',
    modalBg: darkMode ? '#1e293b' : '#ffffff',
    metaBlockBg: darkMode ? '#0f172a' : '#f8fafc'
  };

  const styles = {
    pageWrapper: { background: theme.bg, minHeight: '100vh', padding: isMobile ? '20px 12px' : '40px 20px', boxSizing: 'border-box', transition: 'all 0.3s ease' },
    container: { maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '24px', background: theme.cardBg, padding: isMobile ? '16px' : '20px 24px', borderRadius: '16px', backdropFilter: 'blur(10px)', border: `1px solid ${theme.border}` },
    title: { fontSize: isMobile ? '22px' : '28px', fontWeight: '800', color: theme.mainTitle, margin: 0, letterSpacing: '-0.5px' },
    btnGroup: { display: 'flex', alignItems: 'center', gap: '8px', width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end' },
    addButton: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' },
    logoutButton: { display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', background: theme.modalBg, color: '#ef4444', border: `1px solid ${darkMode ? '#7f1d1d' : '#fee2e2'}`, borderRadius: '8px', cursor: 'pointer', fontWeight: '500' },
    themeToggle: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.cardBg, border: `1px solid ${theme.interactiveBorder}`, color: darkMode ? '#f59e0b' : '#64748b', cursor: 'pointer', padding: '10px', borderRadius: '8px' },
    syncBadge: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '600', background: syncStatus === 'saving' ? (darkMode ? '#7c2d12' : '#ffedd5') : syncStatus === 'error' ? (darkMode ? '#7f1d1d' : '#fee2e2') : (darkMode ? '#064e3b' : '#dcfce7'), color: syncStatus === 'saving' ? (darkMode ? '#fdba74' : '#ea580c') : syncStatus === 'error' ? (darkMode ? '#fca5a5' : '#dc2626') : (darkMode ? '#86efac' : '#16a34a') },
    dataUtilityBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 14px', background: theme.cardBg, border: `1px solid ${theme.interactiveBorder}`, borderRadius: '10px', color: theme.tdText, fontSize: '13px', fontWeight: '600', cursor: 'pointer', flex: isMobile ? 1 : 'none', justifyContent: 'center' },
    searchContainer: { display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'center', gap: '16px', marginBottom: '24px' },
    searchBarWrapper: { position: 'relative', width: '100%', maxWidth: isMobile ? '100%' : '420px' },
    searchBar: { width: '100%', padding: '12px 16px 12px 44px', boxSizing: 'border-box', border: `1px solid ${theme.inputBorder}`, borderRadius: '12px', fontSize: '14px', background: theme.cardBg, color: theme.inputText, outline: 'none' },
    tableCard: { background: theme.tableBg, borderRadius: '16px', overflow: 'hidden', border: `1px solid ${theme.border}`, display: isMobile ? 'none' : 'block' },
    table: { width: '100%', borderCollapse: 'collapse' },
    th: { background: theme.thBg, padding: '16px 20px', textAlign: 'left', fontWeight: '700', color: theme.thText, borderBottom: `2px solid ${darkMode ? '#334155' : '#edf2f7'}`, fontSize: '13px', textTransform: 'uppercase' },
    tr: { transition: 'all 0.2s ease', cursor: 'pointer' },
    td: { padding: '18px 20px', borderBottom: `1px solid ${darkMode ? '#1e293b' : '#f1f5f9'}`, color: theme.tdText, verticalAlign: 'middle' },
    input: { padding: '10px 14px', border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', width: '100%', fontSize: '14px', background: theme.inputBg, color: theme.inputText, boxSizing: 'border-box' },
    fileLabel: { display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '11px 16px', background: theme.interactiveBg, color: theme.tdText, borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', border: `1px solid ${theme.interactiveBorder}`, width: '100%', boxSizing: 'border-box', justifyContent: 'center' },
    
    // Inline Action Action Matrix Buttons
    iconActionBtn: (variant) => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '6px', border: 'none', background: variant === 'read' ? '#2563eb' : (darkMode ? '#1e293b' : '#e2e8f0'), color: variant === 'read' ? '#ffffff' : theme.inputText, cursor: 'pointer' }),

    mobileGrid: { display: isMobile ? 'flex' : 'none', flexDirection: 'column', gap: '16px', marginBottom: '24px' },
    mobileCard: { background: theme.tableBg, padding: '16px', borderRadius: '16px', border: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column', gap: '8px', cursor: 'pointer' },

    modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
    modalContent: { background: theme.modalBg, padding: isMobile ? '20px' : '32px', borderRadius: '24px', width: '95%', maxWidth: selectedRecord ? '1100px' : '600px', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.border}`, position: 'relative', transition: 'max-width 0.3s' },
    modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: `1px solid ${darkMode ? '#334155' : '#e2e8f0'}`, paddingBottom: '16px' },
    closeBtn: { background: theme.interactiveBg, border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: theme.subText },
    metaLabel: { fontWeight: '700', fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px', display: 'block' },
    metaBlock: { marginBottom: '16px', background: theme.metaBlockBg, padding: '16px', borderRadius: '12px', border: `1px solid ${theme.interactiveBorder}` },
    
    paginationFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', background: theme.thBg, borderTop: `1px solid ${darkMode ? '#334155' : '#e2e8f0'}`, flexWrap: 'wrap', gap: '12px', borderRadius: isMobile ? '16px' : '0 0 16px 16px', border: isMobile ? `1px solid ${theme.border}` : 'none' },
    pageBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '8px 14px', borderRadius: '8px', background: theme.cardBg, border: `1px solid ${theme.interactiveBorder}`, color: theme.tdText, fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
    
    avatarCircle: { width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover', background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '700', cursor: 'pointer', border: `2px solid ${theme.interactiveBorder}` },
    avatarLarge: { width: '90px', height: '90px', borderRadius: '50%', objectFit: 'cover', background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '32px', fontWeight: '700', margin: '0 auto 16px', position: 'relative', overflow: 'hidden' },

    // NEW: Clean File Viewer Preview Screen Frame Layout
    previewFrame: { width: '100%', height: '450px', borderRadius: '12px', border: `1px solid ${theme.interactiveBorder}`, background: '#1e293b', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#ffffff' }
  };

  if (!session) {
    return (
      <div style={styles.pageWrapper}>
        <div style={{ maxWidth: '400px', margin: '40px auto 0', padding: '32px 24px', background: theme.cardBg, borderRadius: '20px', border: `1px solid ${theme.border}` }}>
          <h2 style={{ textAlign: 'center', marginBottom: '24px', color: theme.mainTitle, fontWeight: '800' }}>Sign In Engine</h2>
          <form onSubmit={handleAuth}>
            <input type="email" placeholder="Email Address" style={{ width: '100%', padding: '14px', boxSizing: 'border-box', border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', marginBottom: '16px', background: theme.inputBg, color: theme.inputText }} value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input type="password" placeholder="Password" style={{ width: '100%', padding: '14px', boxSizing: 'border-box', border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', marginBottom: '16px', background: theme.inputBg, color: theme.inputText }} value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="submit" style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600' }} disabled={authLoading}>
              {authLoading ? 'Authorizing...' : isRegistering ? 'Register Account' : 'Authorize Login'}
            </button>
          </form>
          <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '14px', color: theme.subText }}>
            {isRegistering ? 'Have an account?' : 'New operator?'} {' '}
            <span style={{ color: '#2563eb', cursor: 'pointer', fontWeight: '600' }} onClick={() => setIsRegistering(!isRegistering)}>
              {isRegistering ? 'Log In' : 'Create Account'}
            </span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.pageWrapper}>
      <div style={styles.container}>
        
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={styles.avatarCircle} onClick={() => setShowProfileModal(true)} title="Configure Profile">
              {avatarUrl ? <img src={avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : <User size={20} />}
            </div>
            <div>
              <h1 style={styles.title}>Knowledge Base</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px', flexWrap: 'wrap' }}>
                <p style={{ color: theme.subText, fontSize: '13px', margin: 0, fontWeight: '600' }}>
                  Operator: <span onClick={() => setShowProfileModal(true)} style={{ cursor: 'pointer', textDecoration: 'underline', color: theme.tdText }}>{username}</span>
                </p>
                <div style={styles.syncBadge}>
                  {syncStatus === 'saving' ? (
                    <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /><span>Saving</span></>
                  ) : syncStatus === 'error' ? (
                    <><CloudLightning size={12} /><span>Error</span></>
                  ) : (
                    <><CloudCheck size={12} /><span>Synced</span></>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div style={styles.btnGroup}>
            <button style={styles.themeToggle} onClick={() => setDarkMode(!darkMode)}>
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button onClick={() => setShowAddModal(true)} style={styles.addButton}><Plus size={16} /> Add Entry</button>
            <button onClick={() => supabase.auth.signOut()} style={styles.logoutButton}><LogOut size={14} /> Leave</button>
          </div>
        </div>

        <div style={styles.searchContainer}>
          <div style={styles.searchBarWrapper}>
            <Search size={18} style={{ position: 'absolute', left: '16px', top: '14px', color: '#94a3b8', zIndex: 10 }} />
            <input type="text" placeholder="Search entire cloud database instantly..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }} style={styles.searchBar} />
          </div>

          <div style={{ display: 'flex', gap: '8px', width: isMobile ? '100%' : 'auto' }}>
            <button onClick={handleExportCSV} style={styles.dataUtilityBtn}>
              <Download size={14} /> Export
            </button>
            <label style={styles.dataUtilityBtn}>
              <FileSpreadsheet size={14} /> Import
              <input type="file" accept=".csv" onChange={handleImportCSV} style={{ display: 'none' }} />
            </label>
          </div>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', color: theme.subText, fontWeight: '500' }}>Reading data streams...</p>
        ) : (
          <>
            {/* DESKTOP MODE VIEW */}
            <div style={styles.tableCard}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, width: '8%' }}>#</th>
                    <th style={{ ...styles.th, width: '27%' }}>Topic Title</th>
                    <th style={{ ...styles.th, width: '45%' }}>Description</th>
                    <th style={{ ...styles.th, width: '20%' }}>Attached Files</th>
                  </tr>
                </thead>
                <tbody>
                  {topics.map((topic, index) => {
                    const filesCount = parseFilesList(topic).length;
                    return (
                      <tr 
                        key={topic.id} 
                        style={styles.tr}
                        onClick={() => { setSelectedRecord(topic); setActivePreviewFile(null); }}
                        onMouseEnter={(e) => e.currentTarget.style.background = darkMode ? '#1e293b' : '#f8fafc'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ ...styles.td, fontWeight: '600', color: '#94a3b8' }}>
                          {(currentPage - 1) * ITEMS_PER_PAGE + index + 1}
                        </td>
                        <td style={{ ...styles.td, fontWeight: '700', color: theme.inputText }}>
                          {topic.title || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Untitled</span>}
                        </td>
                        <td style={{ ...styles.td, color: theme.subText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '340px' }}>
                          {topic.description || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No description summary notes...</span>}
                        </td>
                        <td style={styles.td}>
                          {filesCount > 0 ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: darkMode ? '#1e293b' : '#e2e8f0', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '700', color: theme.inputText }}>
                              <FileText size={13} style={{ color: '#2563eb' }} /> {filesCount} {filesCount === 1 ? 'file' : 'files'}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: '13px' }}>None</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MOBILE LAYOUT MODE */}
            <div style={styles.mobileGrid}>
              {topics.map((topic) => {
                const filesCount = parseFilesList(topic).length;
                return (
                  <div key={topic.id} style={styles.mobileCard} onClick={() => { setSelectedRecord(topic); setActivePreviewFile(null); }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '15px', fontWeight: '700', color: theme.inputText }}>{topic.title || 'Untitled'}</span>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>{topic.id.substring(0, 6)}</span>
                    </div>
                    <p style={{ color: theme.subText, fontSize: '13px', margin: '4px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {topic.description || 'No summary notes...'}
                    </p>
                    {filesCount > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#2563eb', fontWeight: '600' }}>
                        <FileText size={12} /> {filesCount} linked file attachments
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* SERVER-SIDE PAGINATION CONTROL PANEL FOOTER */}
            <div style={styles.paginationFooter}>
              <span style={{ fontSize: '14px', color: theme.subText, fontWeight: '500' }}>
                Showing <b>{topics.length}</b> of <b>{totalCount}</b> cloud logs
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button style={styles.pageBtn} onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1}>
                  <ChevronLeft size={16} /> Prev
                </button>
                <span style={{ fontSize: '14px', color: theme.inputText, fontWeight: '700', padding: '0 8px' }}>
                  {currentPage} / {totalPages}
                </span>
                <button style={styles.pageBtn} onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages}>
                  Next <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}

        {/* ADD ENTRY MODAL */}
        {showAddModal && (
          <div style={styles.modalOverlay} onClick={() => setShowAddModal(false)}>
            <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Plus size={22} style={{ color: '#2563eb' }} />
                  <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: theme.mainTitle }}>Create Knowledge Node</h3>
                </div>
                <button style={styles.closeBtn} onClick={() => setShowAddModal(false)}><X size={16} /></button>
              </div>

              <form onSubmit={handleCreateNewEntry} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div>
                  <label style={styles.metaLabel}>Topic Title *</label>
                  <input type="text" placeholder="Provide a clear index identifier name..." style={styles.input} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required />
                </div>
                <div>
                  <label style={styles.metaLabel}>Contextual Description</label>
                  <textarea placeholder="Enter analytical records notes..." style={{ ...styles.input, minHeight: '100px', resize: 'vertical', fontFamily: 'inherit' }} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
                </div>
                <div>
                  <label style={styles.metaLabel}>File Attachment</label>
                  <div style={styles.metaBlock}>
                    <input type="file" id="modal-upload-input" style={{ display: 'none' }} onChange={(e) => setNewFile(e.target.files[0])} />
                    <label htmlFor="modal-upload-input" style={{ ...styles.fileLabel, background: theme.inputBg }}>
                      <Upload size={16} /> {newFile ? 'Change Selected File' : 'Choose Data File Payload'}
                    </label>
                    {newFile && (
                      <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', background: theme.modalBg, padding: '8px 12px', borderRadius: '6px', border: `1px solid ${theme.interactiveBorder}` }}>
                        <FileText size={14} style={{ color: '#2563eb', flexShrink: 0, marginRight: '8px' }} />
                        <span style={{ fontSize: '13px', color: theme.tdText, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{newFile.name}</span>
                        <button type="button" onClick={() => setNewFile(null)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', marginLeft: 'auto' }}><X size={14} /></button>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button type="button" style={styles.pageBtn} onClick={() => setShowAddModal(false)} disabled={isCreatingEntry}>Cancel</button>
                  <button type="submit" style={styles.addButton} disabled={isCreatingEntry}>
                    {isCreatingEntry ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : 'Publish Entry'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* DETAILED WORKSPACE MODAL PANEL WITH LIVE DOCUMENT VIEWER PREVIEW GRID */}
        {selectedRecord && (
          <div style={styles.modalOverlay} onClick={() => setSelectedRecord(null)}>
            <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Info size={22} style={{ color: '#2563eb' }} />
                  <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: theme.mainTitle }}>Record Workspace Panel</h3>
                </div>
                <button style={styles.closeBtn} onClick={() => setSelectedRecord(null)}><X size={16} /></button>
              </div>

              {/* Flex Grid splits into two columns on desktop viewports when a file preview is triggered */}
              <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '24px' }}>
                
                {/* LEFT WORKSPACE SIDE: Meta Parameter Fields Modification */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div>
                    <label style={styles.metaLabel}>Topic Title (Editable)</label>
                    <input 
                      type="text" 
                      style={styles.input} 
                      value={selectedRecord.title || ''} 
                      onChange={(e) => handleFieldChange(selectedRecord.id, 'title', e.target.value)} 
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={styles.metaLabel}>Detailed Contextual Description (Editable)</label>
                      {aiGeneratingId === selectedRecord.id && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#a855f7', fontWeight: '700' }}>
                          <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> AI Analyzing...
                        </div>
                      )}
                    </div>
                    <textarea 
                      placeholder="Enter operational details summary..." 
                      style={{ ...styles.input, minHeight: '110px', resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5' }} 
                      value={selectedRecord.description || ''} 
                      onChange={(e) => handleFieldChange(selectedRecord.id, 'description', e.target.value)} 
                    />
                  </div>

                  <div>
                    <label style={styles.metaLabel}>Bound File Matrix Attachments</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                      {parseFilesList(selectedRecord).map((file, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', background: theme.metaBlockBg, padding: '10px 14px', borderRadius: '8px', border: `1px solid ${theme.interactiveBorder}` }}>
                          <FileText size={16} style={{ color: '#2563eb', marginRight: '8px', flexShrink: 0 }} />
                          <span style={{ fontSize: '13px', color: theme.inputText, fontWeight: '600', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '160px' }}>
                            {file.name}
                          </span>
                          
                          {/* NEW: DUAL INTERACTION CLUSTER (READ AND DOWNLOAD TOGETHER) */}
                          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button 
                              type="button" 
                              title="Read File Document Here"
                              style={styles.iconActionBtn('read')} 
                              onClick={() => setActivePreviewFile(file)}
                            >
                              <Eye size={14} />
                            </button>
                            <a 
                              href={file.url} 
                              download 
                              target="_blank" 
                              rel="noreferrer" 
                              title="Download File Locally"
                              style={styles.iconActionBtn('download')}
                            >
                              <Download size={14} />
                            </a>
                            <button onClick={() => handleModalDeleteFile(idx, selectedRecord)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', padding: '4px' }}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ position: 'relative' }}>
                      <input type="file" id="modal-append-file" style={{ display: 'none' }} onChange={(e) => handleModalAppendFile(e, selectedRecord)} disabled={uploadingInModal} />
                      <label htmlFor="modal-append-file" style={{ ...styles.fileLabel, background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', color: 'white' }}>
                        {uploadingInModal ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={16} />}
                        Add More Files Payload
                      </label>
                    </div>
                  </div>

                  <div style={{ display: 'flex', borderTop: `1px solid ${theme.interactiveBorder}`, paddingTop: '16px', alignItems: 'center', marginTop: 'auto' }}>
                    <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '500' }}>UUID: {selectedRecord.id}</span>
                    <button onClick={() => handleDeleteRow(selectedRecord.id, null)} style={{ ...styles.logoutButton, padding: '8px 14px', marginLeft: 'auto', fontSize: '13px' }}>
                      <Trash2 size={14} /> Destroy Record
                    </button>
                  </div>
                </div>

                {/* NEW RIGHT WORKSPACE SIDE: Interactive Inline Document Viewer Frame */}
                {activePreviewFile && (
                  <div style={{ flex: 1.1, display: 'flex', flexDirection: 'column', gap: '8px', minWidth: isMobile ? '100%' : '440px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={styles.metaLabel}>Reading Payload: <b style={{ color: theme.inputText }}>{activePreviewFile.name}</b></span>
                      <button style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', padding: '2px' }} onClick={() => setActivePreviewFile(null)}>
                        <X size={16} />
                      </button>
                    </div>

                    <div style={styles.previewFrame}>
                      {getFileCategory(activePreviewFile.name) === 'image' ? (
                        <img 
                          src={activePreviewFile.url} 
                          alt="Document Preview Content" 
                          style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#0f172a' }} 
                        />
                      ) : getFileCategory(activePreviewFile.name) === 'viewable-doc' ? (
                        <iframe 
                          src={activePreviewFile.url} 
                          title="Inline Resource Content Preview" 
                          style={{ width: '100%', height: '100%', border: 'none', background: '#ffffff' }} 
                        />
                      ) : (
                        <div style={{ textAlign: 'center', padding: '24px' }}>
                          <FileText size={48} style={{ color: '#64748b', marginBottom: '12px' }} />
                          <p style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>Binary Resource Preview Restricted</p>
                          <p style={{ margin: '4px 0 16px', fontSize: '12px', color: '#94a3b8' }}>Browsers can't render this file format directly inline.</p>
                          <a href={activePreviewFile.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#2563eb', color: '#ffffff', padding: '8px 16px', borderRadius: '6px', textDecoration: 'none', fontSize: '13px', fontWeight: '600' }}>
                            <Download size={14} /> Open in New Tab
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        )}

        {/* PROFILE WORKSPACE MODAL */}
        {showProfileModal && (
          <div style={styles.modalOverlay} onClick={() => setShowProfileModal(false)}>
            <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Settings size={20} style={{ color: theme.tdText }} />
                  <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: theme.mainTitle }}>System Profile Workspace</h3>
                </div>
                <button style={styles.closeBtn} onClick={() => setShowProfileModal(false)}><X size={16} /></button>
              </div>

              <form onSubmit={handleUpdateProfile}>
                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                  <div style={styles.avatarLarge}>
                    {avatarUrl ? <img src={avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <User size={40} />}
                    <label htmlFor="avatar-file-input" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(15, 23, 42, 0.75)', padding: '6px 0', cursor: 'pointer', display: 'flex', justifyContent: 'center', color: 'white' }}>
                      <Camera size={14} />
                    </label>
                  </div>
                  <input type="file" id="avatar-file-input" style={{ display: 'none' }} accept="image/*" onChange={handleAvatarUpload} disabled={updatingProfile} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={styles.metaLabel}>System Identity Callsign</label>
                    <input type="text" style={styles.input} value={username} onChange={(e) => setUsername(e.target.value)} required />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
                  <button type="button" style={styles.pageBtn} onClick={() => setShowProfileModal(false)}>Dismiss</button>
                  <button type="submit" style={styles.addButton} disabled={updatingProfile}>Save Changes</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}