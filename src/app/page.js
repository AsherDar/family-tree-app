"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import ReactFlow, { Background, Controls, Panel, applyNodeChanges, applyEdgeChanges, Handle, Position, ReactFlowProvider, useReactFlow } from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';
import { supabase } from './supabase';

const getYear = (dateStr) => {
  if (!dateStr) return 9999;
  const match = dateStr.match(/\d{4}/);
  return match ? parseInt(match[0], 10) : 9999;
};

const getExtendedFamily = (centerId, allMembers, upLevels = 1, downLevels = 1) => {
  const visibleIds = new Set();
  if (!centerId) return [];
  visibleIds.add(String(centerId));

  let currentUp = [String(centerId)];
  for (let i = 0; i < upLevels; i++) {
    let nextUp = [];
    currentUp.forEach(id => {
      const person = allMembers.find(m => String(m.id) === id);
      if (person) {
        if (person.father_id) { visibleIds.add(String(person.father_id)); nextUp.push(String(person.father_id)); }
        if (person.mother_id) { visibleIds.add(String(person.mother_id)); nextUp.push(String(person.mother_id)); }
      }
    });
    currentUp = nextUp;
  }

  let currentDown = [String(centerId)];
  for (let i = 0; i < downLevels; i++) {
    let nextDown = [];
    allMembers.forEach(m => {
      if (currentDown.includes(String(m.father_id)) || currentDown.includes(String(m.mother_id))) {
        visibleIds.add(String(m.id));
        nextDown.push(String(m.id));
      }
    });
    currentDown = nextDown;
  }

  const centerNode = allMembers.find(m => String(m.id) === String(centerId));
  if (centerNode && (centerNode.father_id || centerNode.mother_id)) {
    allMembers.forEach(m => {
      if (m.id !== centerNode.id && (
        (centerNode.father_id && String(m.father_id) === String(centerNode.father_id)) ||
        (centerNode.mother_id && String(m.mother_id) === String(centerNode.mother_id))
      )) {
        visibleIds.add(String(m.id));
      }
    });
  }

  const currentArr = Array.from(visibleIds);
  currentArr.forEach(vid => {
    allMembers.forEach(m => {
      if (String(m.spouse_id) === vid || String(allMembers.find(x => String(x.id) === vid)?.spouse_id) === String(m.id)) {
        visibleIds.add(String(m.id));
      }
    });
  });

  return allMembers.filter(m => visibleIds.has(String(m.id)));
};

const MemberAvatar = ({ member, data, isMain }) => {
  const isFemale = member.gender === 'נקבה' || member.gender === 'female';
  const defaultImg = isFemale ? "/female.png" : "/male.png";
  const ringColor = isFemale ? 'ring-pink-400' : 'ring-blue-500';
  const mainHighlight = isMain ? 'shadow-md scale-105' : 'opacity-90 hover:opacity-100';

  return (
    <div 
      className={`flex flex-col items-center cursor-pointer transition-transform hover:scale-110 px-2 ${mainHighlight}`}
      onClick={(e) => {
        e.stopPropagation(); 
        data.onMemberClick(member); 
      }}
    >
      <img src={member.photo_url || defaultImg} alt={`${member.first_name}`} className={`w-14 h-14 rounded-full object-cover ring-2 ${ringColor}`} />
      <div className="mt-2 text-xs font-bold text-gray-800 text-center w-16 leading-tight">
        {member.first_name} {member.last_name}
      </div>
    </div>
  );
};

const UnifiedFamilyNode = ({ data }) => {
  const { mainMember, spouses, isFocal } = data;
  
  const allMembers = [mainMember, ...spouses];
  allMembers.sort((a, b) => {
    const isAMale = a.gender === 'זכר' || a.gender === 'male';
    const isBMale = b.gender === 'זכר' || b.gender === 'male';
    if (isAMale && !isBMale) return 1; 
    if (!isAMale && isBMale) return -1; 
    return 0;
  });

  const focalStyle = isFocal ? 'ring-4 ring-yellow-400 shadow-2xl bg-yellow-50' : 'shadow-lg bg-white border-gray-200';

  return (
    <div className={`p-3 rounded-2xl border-2 flex flex-row items-center justify-center gap-2 transition-all ${focalStyle}`}>
      <Handle type="target" position={Position.Top} id="top" className="w-3 h-3 bg-gray-500" />
      {allMembers.map(m => (
        <MemberAvatar key={m.id} member={m} data={data} isMain={m.id === mainMember.id} />
      ))}
      <Handle type="source" position={Position.Bottom} id="bottom" className="w-3 h-3 bg-gray-500" />
    </div>
  );
};

const nodeTypes = { unifiedFamily: UnifiedFamilyNode };

const getLayoutedElements = (nodes, edges) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'TB', ranksep: 120, nodesep: 80 }); 

  nodes.forEach(node => {
    const avatarsCount = 1 + (node.data.spouses ? node.data.spouses.length : 0);
    const boxWidth = avatarsCount * 90 + 30; 
    dagreGraph.setNode(node.id, { width: boxWidth, height: 120 });
  });

  edges.forEach(edge => dagreGraph.setEdge(edge.source, edge.target));
  dagre.layout(dagreGraph);

  nodes.forEach(node => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.width = nodeWithPosition.width; 
    node.position = { x: -nodeWithPosition.x - nodeWithPosition.width / 2, y: nodeWithPosition.y - 60 };
  });

  return { nodes, edges };
};

const resizeImage = (file, maxWidth = 400, maxHeight = 400) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
      };
    };
  });
};

function FamilyTreeApp() {
  const [allMembers, setAllMembers] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [baseNodes, setBaseNodes] = useState([]); 
  const [edges, setEdges] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [focalMemberId, setFocalMemberId] = useState(null); 
  const [isDraggable, setIsDraggable] = useState(false); 
  
  const [editMode, setEditMode] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false); 
  
  const [openSections, setOpenSections] = useState({ parents: true, spouses: true, children: true, siblings: true });
  const toggleSection = (sec) => setOpenSections(prev => ({ ...prev, [sec]: !prev[sec] }));
  
  const [genUp, setGenUp] = useState(1);
  const [genDown, setGenDown] = useState(1);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalConfig, setModalConfig] = useState(null); 
  const [formData, setFormData] = useState({});
  const [modalTab, setModalTab] = useState('new'); 
  const [selectedExistingId, setSelectedExistingId] = useState('');
  const [existingSearchQuery, setExistingSearchQuery] = useState(''); // שדה חיפוש חדש לחיבור אדם קיים
  const [selectedImageFile, setSelectedImageFile] = useState(null); 
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const { setCenter, fitView } = useReactFlow(); 
  const searchInputRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user ?? null);
      setEditMode(!!session?.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
      setEditMode(!!session?.user);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: authPassword,
    });
    
    if (error) {
      setAuthError('אימייל או סיסמה שגויים. נסה שוב.');
    } else {
      setIsLoginOpen(false);
      setAuthEmail('');
      setAuthPassword('');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const fetchFamily = useCallback(async () => {
    const { data, error } = await supabase.from('family_members').select('*');
    if (error) { console.error("שגיאה:", error); return; }
    
    const activeMembers = data.filter(m => m.is_deleted !== true);
    const sortedData = activeMembers.sort((a, b) => getYear(a.birth_date) - getYear(b.birth_date));
    setAllMembers(sortedData);
    
    setFocalMemberId((prevFocalId) => {
      if (prevFocalId) {
        const updatedFocal = sortedData.find(m => String(m.id) === String(prevFocalId));
        if (updatedFocal) {
          const father = sortedData.find(m => m.id === updatedFocal.father_id);
          const mother = sortedData.find(m => m.id === updatedFocal.mother_id);
          setSelectedMember({ ...updatedFocal, father_obj: father, mother_obj: mother });
          return prevFocalId;
        }
      }
      return null; 
    });
  }, []);

  useEffect(() => {
    fetchFamily();
  }, [fetchFamily]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const lowerQuery = searchQuery.toLowerCase();
    const results = allMembers.filter(m => {
      const fullName = `${m.first_name} ${m.last_name}`.toLowerCase();
      return fullName.includes(lowerQuery);
    });
    setSearchResults(results);
  }, [searchQuery, allMembers]);

  const handleSelectMember = useCallback((rawMember, dataList = allMembers) => {
    const father = dataList.find(m => m.id === rawMember.father_id);
    const mother = dataList.find(m => m.id === rawMember.mother_id);
    setSelectedMember({ ...rawMember, father_obj: father, mother_obj: mother });
    setFocalMemberId(String(rawMember.id));
  }, [allMembers]);

  const handleUnlink = async (type, relativeId) => {
    if (!window.confirm("האם לנתק את הקשר? הדמות תישאר במערכת אך הקו ינותק.")) return;
    
    try {
      if (type === 'father') {
        await supabase.from('family_members').update({ father_id: null }).eq('id', selectedMember.id);
      } else if (type === 'mother') {
        await supabase.from('family_members').update({ mother_id: null }).eq('id', selectedMember.id);
      } else if (type === 'child') {
        const isSelectedMale = selectedMember.gender === 'זכר' || selectedMember.gender === 'male';
        const updateField = isSelectedMale ? { father_id: null } : { mother_id: null };
        await supabase.from('family_members').update(updateField).eq('id', relativeId);
      } else if (type === 'spouse') {
        const spouse = allMembers.find(m => String(m.id) === String(relativeId));
        if (String(selectedMember.spouse_id) === String(relativeId)) {
          await supabase.from('family_members').update({ spouse_id: null }).eq('id', selectedMember.id);
        } else if (spouse && String(spouse.spouse_id) === String(selectedMember.id)) {
          await supabase.from('family_members').update({ spouse_id: null }).eq('id', relativeId);
        }
      } else if (type === 'sibling') {
        const sibling = allMembers.find(m => m.id === relativeId);
        const updateField = {};
        if (sibling.father_id === selectedMember.father_id) updateField.father_id = null;
        if (sibling.mother_id === selectedMember.mother_id) updateField.mother_id = null;
        if (Object.keys(updateField).length > 0) {
          await supabase.from('family_members').update(updateField).eq('id', relativeId);
        }
      }
      fetchFamily();
    } catch (err) {
      alert("שגיאה בניתוק: " + err.message);
    }
  };

  const openModal = (type, title, existingData = null) => {
    setModalConfig({ type, title });
    setModalTab('new');
    setSelectedExistingId('');
    setExistingSearchQuery(''); // איפוס תיבת החיפוש הפנימית
    setSelectedImageFile(null); 
    
    if (existingData) {
      setFormData(existingData);
    } else {
      setFormData({
        first_name: '', 
        last_name: selectedMember ? selectedMember.last_name : '',
        gender: type === 'add_father' ? 'זכר' : (type === 'add_mother' ? 'נקבה' : 'זכר'),
        birth_date: '', birth_place: '', origin_country: '', occupation: '',
        death_date: '', death_place: '', life_story: '', photo_url: ''
      });
    }
    setIsModalOpen(true);
  };

  const handleSaveForm = async (e) => {
    e.preventDefault();
    try {
      let addedSpouseId = null;

      if (modalTab === 'existing' && modalConfig.type !== 'edit') {
        if (!selectedExistingId) { alert("יש לבחור אדם מהרשימה"); return; }
        
        if (modalConfig.type === 'add_child') {
          const isSelectedMale = selectedMember.gender === 'זכר' || selectedMember.gender === 'male';
          const field = isSelectedMale ? { father_id: selectedMember.id } : { mother_id: selectedMember.id };
          
          const spouses = allMembers.filter(m => m.spouse_id === selectedMember.id || selectedMember.spouse_id === m.id);
          if (spouses.length === 1) {
            if (isSelectedMale) field.mother_id = spouses[0].id;
            else field.father_id = spouses[0].id;
          }
          
          await supabase.from('family_members').update(field).eq('id', selectedExistingId);
        } else if (modalConfig.type === 'add_father') {
          await supabase.from('family_members').update({ father_id: selectedExistingId }).eq('id', selectedMember.id);
        } else if (modalConfig.type === 'add_mother') {
          await supabase.from('family_members').update({ mother_id: selectedExistingId }).eq('id', selectedMember.id);
        } else if (modalConfig.type === 'add_spouse') {
          await supabase.from('family_members').update({ spouse_id: selectedExistingId }).eq('id', selectedMember.id);
          addedSpouseId = selectedExistingId;
        } else if (modalConfig.type === 'add_sibling') {
          const field = {};
          if (selectedMember.father_id) field.father_id = selectedMember.father_id;
          if (selectedMember.mother_id) field.mother_id = selectedMember.mother_id;
          if (Object.keys(field).length > 0) {
            await supabase.from('family_members').update(field).eq('id', selectedExistingId);
          }
        }

        if (modalConfig.type === 'add_spouse' && addedSpouseId) {
          const isSelectedMale = selectedMember.gender === 'זכר' || selectedMember.gender === 'male';
          const missingParentField = isSelectedMale ? 'mother_id' : 'father_id';
          const childrenWithoutParent = allMembers.filter(m => 
            (m.father_id === selectedMember.id || m.mother_id === selectedMember.id) && !m[missingParentField]
          );

          if (childrenWithoutParent.length > 0) {
            if (window.confirm(`לדמות זו יש ${childrenWithoutParent.length} ילדים במערכת.\nהאם לקשר אותם אוטומטית לבן/בת הזוג שבחרת?`)) {
              for (const child of childrenWithoutParent) {
                const updateData = {};
                updateData[missingParentField] = addedSpouseId;
                await supabase.from('family_members').update(updateData).eq('id', child.id);
              }
            }
          }
        }

        setIsModalOpen(false);
        fetchFamily();
        return;
      }

      const dataToSave = { ...formData };
      
      delete dataToSave.father_obj;
      delete dataToSave.mother_obj;
      delete dataToSave.last_updated;
      
      if (selectedImageFile) {
        const compressedImage = await resizeImage(selectedImageFile);
        const fileExt = 'jpg';
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, compressedImage, { contentType: 'image/jpeg' });
          
        if (uploadError) throw uploadError;
        
        const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
        dataToSave.photo_url = publicUrlData.publicUrl;
      }
      
      if (modalConfig.type === 'edit') {
        const { data: currentRecord, error: checkErr } = await supabase
          .from('family_members')
          .select('last_updated')
          .eq('id', formData.id)
          .single();

        if (checkErr) throw checkErr;

        if (currentRecord.last_updated && formData.last_updated && currentRecord.last_updated !== formData.last_updated) {
          alert("⚠️ שגיאה: משתמש אחר עדכן דמות זו בזמן שערכת אותה. העמוד ירוענן כעת כדי שתוכל לראות את השינויים ולמנוע דריסת מידע.");
          setIsModalOpen(false);
          fetchFamily();
          return;
        }

        const targetId = dataToSave.id;
        delete dataToSave.id; 

        const { error } = await supabase.from('family_members').update(dataToSave).eq('id', targetId);
        if (error) throw error;
      } else {
        delete dataToSave.id; 

        if (modalConfig.type === 'add_child') {
          const isSelectedMale = selectedMember.gender === 'זכר' || selectedMember.gender === 'male';
          if (isSelectedMale) dataToSave.father_id = selectedMember.id;
          else dataToSave.mother_id = selectedMember.id;
          
          const spouses = allMembers.filter(m => m.spouse_id === selectedMember.id || selectedMember.spouse_id === m.id);
          if (spouses.length === 1) {
            if (isSelectedMale) dataToSave.mother_id = spouses[0].id;
            else dataToSave.father_id = spouses[0].id;
          }
        } else if (modalConfig.type === 'add_spouse') {
          dataToSave.spouse_id = selectedMember.id;
        } else if (modalConfig.type === 'add_sibling') {
          if (selectedMember.father_id) dataToSave.father_id = selectedMember.father_id;
          if (selectedMember.mother_id) dataToSave.mother_id = selectedMember.mother_id;
        }

        const { data: newRow, error: insertErr } = await supabase.from('family_members').insert([dataToSave]).select();
        if (insertErr) throw insertErr;
        const insertedId = newRow[0].id;

        if (modalConfig.type === 'add_father') {
          await supabase.from('family_members').update({ father_id: insertedId }).eq('id', selectedMember.id);
        } else if (modalConfig.type === 'add_mother') {
          await supabase.from('family_members').update({ mother_id: insertedId }).eq('id', selectedMember.id);
        } else if (modalConfig.type === 'add_spouse') {
          addedSpouseId = insertedId;
        }

        if (modalConfig.type === 'add_spouse' && addedSpouseId) {
          const isSelectedMale = selectedMember.gender === 'זכר' || selectedMember.gender === 'male';
          const missingParentField = isSelectedMale ? 'mother_id' : 'father_id';
          const childrenWithoutParent = allMembers.filter(m => 
            (m.father_id === selectedMember.id || m.mother_id === selectedMember.id) && !m[missingParentField]
          );

          if (childrenWithoutParent.length > 0) {
            if (window.confirm(`לדמות זו יש ${childrenWithoutParent.length} ילדים במערכת.\nהאם לקשר אותם אוטומטית לבן/בת הזוג שהוספת כעת?`)) {
              for (const child of childrenWithoutParent) {
                const updateData = {};
                updateData[missingParentField] = addedSpouseId;
                await supabase.from('family_members').update(updateData).eq('id', child.id);
              }
            }
          }
        }
      }
      
      setIsModalOpen(false);
      fetchFamily();
    } catch (err) {
      alert("שגיאה בשמירה: " + err.message);
    }
  };

  const handleDelete = async () => {
    const childrenCount = allMembers.filter(m => m.father_id === selectedMember.id || m.mother_id === selectedMember.id).length;
    const spousesCount = allMembers.filter(m => m.spouse_id === selectedMember.id || selectedMember.spouse_id === m.id).length;
    const confirmMsg = `האם ברצונך למחוק את ${selectedMember.first_name} ${selectedMember.last_name} לחלוטין?\n\nלאדם זה מקושרים:\n- ${childrenCount} ילדים\n- ${spousesCount} בני/בנות זוג\n\nהמחיקה תעלים אותו.`;
    
    if (window.confirm(confirmMsg)) {
      const { error } = await supabase.from('family_members').update({ is_deleted: true }).eq('id', selectedMember.id);
      if (error) {
        alert("שגיאה במחיקה: " + error.message);
      } else {
        setSelectedMember(null);
        setFocalMemberId(null);
        fetchFamily(); 
      }
    }
  };

  useEffect(() => {
    if (allMembers.length === 0 || !focalMemberId) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const visibleMembers = getExtendedFamily(focalMemberId, allMembers, genUp, genDown);
    const visibleIds = new Set(visibleMembers.map(m => String(m.id)));
    
    const memberToGroupMap = {};
    const groupedNodesData = [];
    const processedIds = new Set();

    visibleMembers.forEach(member => {
      const mId = String(member.id);
      if (!processedIds.has(mId)) {
        const spouses = visibleMembers.filter(m => m.id !== member.id && !processedIds.has(String(m.id)) && (String(m.spouse_id) === mId || String(member.spouse_id) === String(m.id)));
        const groupId = `group_${mId}`;
        memberToGroupMap[mId] = groupId;
        processedIds.add(mId);
        spouses.forEach(s => { memberToGroupMap[s.id] = groupId; processedIds.add(String(s.id)); });

        const isGroupFocal = (mId === String(focalMemberId)) || spouses.some(s => String(s.id) === String(focalMemberId));
        let mainMember = member;
        let groupSpouses = spouses;

        if (spouses.some(s => String(s.id) === String(focalMemberId))) {
          mainMember = spouses.find(s => String(s.id) === String(focalMemberId));
          groupSpouses = [member, ...spouses.filter(s => String(s.id) !== String(focalMemberId))];
        }

        groupedNodesData.push({ id: groupId, mainMember: mainMember, spouses: groupSpouses, isFocal: isGroupFocal });
      }
    });

    const rawNodes = groupedNodesData.map(group => ({
      id: group.id, type: 'unifiedFamily', position: { x: 0, y: 0 }, 
      data: { mainMember: group.mainMember, spouses: group.spouses, isFocal: group.isFocal, onMemberClick: handleSelectMember }
    }));

    const rawEdges = [];
    const createdEdges = new Set();

    visibleMembers.forEach(member => {
      const mId = String(member.id);
      const targetGroupId = memberToGroupMap[mId];
      const drawEdge = (parentId) => {
        if (parentId && visibleIds.has(String(parentId))) {
          const sourceGroupId = memberToGroupMap[String(parentId)];
          const edgeId = `edge-${sourceGroupId}-${targetGroupId}`;
          if (sourceGroupId && targetGroupId && sourceGroupId !== targetGroupId && !createdEdges.has(edgeId)) {
            rawEdges.push({ id: edgeId, source: sourceGroupId, sourceHandle: 'bottom', target: targetGroupId, targetHandle: 'top', type: 'smoothstep', animated: true, style: { stroke: '#9ca3af', strokeWidth: 2 } });
            createdEdges.add(edgeId);
          }
        }
      };
      drawEdge(member.father_id);
      drawEdge(member.mother_id);
    });

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(rawNodes, rawEdges);
    setNodes(layoutedNodes);
    setBaseNodes(layoutedNodes.map(node => ({ ...node, position: { ...node.position } })));
    setEdges(layoutedEdges);

    setTimeout(() => {
      const targetNode = layoutedNodes.find(n => n.data.isFocal);
      if (targetNode) {
        setCenter(targetNode.position.x + (targetNode.width / 2), targetNode.position.y + 60, { zoom: 1, duration: 800 });
      }
    }, 400);

  }, [allMembers, focalMemberId, genUp, genDown, handleSelectMember, setCenter]);

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);

  const resetLayout = () => {
    setNodes(baseNodes.map(node => ({ ...node, position: { ...node.position } })));
    fitView({ duration: 800, padding: 0.2 });
  };

  const getChildren = () => allMembers.filter(m => m.father_id === selectedMember?.id || m.mother_id === selectedMember?.id);
  const getSpouses = () => allMembers.filter(m => m.spouse_id === selectedMember?.id || selectedMember?.spouse_id === m.id);
  
  const getSiblings = () => {
    if (!selectedMember) return [];
    const fid = selectedMember.father_id;
    const mid = selectedMember.mother_id;
    if (!fid && !mid) return [];
    return allMembers.filter(m => 
      m.id !== selectedMember.id && 
      ((fid && m.father_id === fid) || (mid && m.mother_id === mid))
    );
  };

  const availableMembers = allMembers
    .filter(m => String(m.id) !== String(selectedMember?.id))
    .sort((a, b) => (a.first_name || '').localeCompare(b.first_name || ''));

  // סינון הדמויות לחיבור אדם קיים (חלון המודאל)
  const filteredAvailableMembers = availableMembers.filter(m => {
    const fullName = `${m.first_name} ${m.last_name}`.toLowerCase();
    return fullName.includes(existingSearchQuery.toLowerCase());
  });

  return (
    <div className="w-screen h-screen bg-gray-50 flex" dir="rtl">
      
      {isLoginOpen && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 relative">
            <button onClick={() => setIsLoginOpen(false)} className="absolute top-4 left-4 text-gray-500 hover:text-red-500 text-2xl font-bold">&times;</button>
            <h2 className="text-xl font-bold text-gray-800 mb-4 text-center">התחברות למצב עריכה</h2>
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              {authError && <div className="bg-red-50 text-red-600 p-2 rounded text-sm text-center">{authError}</div>}
              <div>
                <label className="text-sm font-bold text-gray-600 mb-1 block">אימייל</label>
                <input required type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} className="w-full border rounded-lg p-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-400 text-left" dir="ltr" />
              </div>
              <div>
                <label className="text-sm font-bold text-gray-600 mb-1 block">סיסמה</label>
                <input required type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} className="w-full border rounded-lg p-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-400 text-left" dir="ltr" />
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg hover:bg-blue-700 mt-2">התחבר</button>
            </form>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col relative overflow-hidden">
            <div className="bg-gray-100 p-4 flex justify-between items-center border-b">
              <h2 className="text-xl font-bold text-gray-800">{modalConfig.title}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-500 hover:text-red-500 text-2xl font-bold leading-none">&times;</button>
            </div>
            {modalConfig.type !== 'edit' && (
              <div className="flex bg-gray-50 border-b">
                <button onClick={() => setModalTab('new')} className={`flex-1 py-3 font-bold text-sm ${modalTab === 'new' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                  ✨ צור אדם חדש
                </button>
                <button onClick={() => setModalTab('existing')} className={`flex-1 py-3 font-bold text-sm ${modalTab === 'existing' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                  🔗 חבר לאדם קיים במערכת
                </button>
              </div>
            )}
            <form onSubmit={handleSaveForm} className="p-6 overflow-y-auto">
              {modalTab === 'existing' && modalConfig.type !== 'edit' ? (
                <div className="py-2">
                  <label className="block text-gray-700 font-bold mb-4">חפש ובחר אדם מהמערכת:</label>
                  
                  {selectedExistingId ? (
                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl flex justify-between items-center mb-4">
                      <span className="font-bold text-blue-800">
                        נבחר: {availableMembers.find(m => m.id === selectedExistingId)?.first_name} {availableMembers.find(m => m.id === selectedExistingId)?.last_name}
                      </span>
                      <button type="button" onClick={() => setSelectedExistingId('')} className="text-red-500 text-sm font-bold hover:underline">
                        בטל בחירה
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        placeholder="הקלד שם לחיפוש..."
                        value={existingSearchQuery}
                        onChange={e => setExistingSearchQuery(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg p-3 bg-white focus:ring-2 focus:ring-blue-400 text-right mb-2"
                        dir="rtl"
                      />
                      <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg custom-scrollbar shadow-inner bg-gray-50">
                        {filteredAvailableMembers.length > 0 ? (
                          filteredAvailableMembers.map(m => {
                            const father = allMembers.find(f => f.id === m.father_id);
                            const mother = allMembers.find(mo => mo.id === m.mother_id);
                            const parentsStr = [father ? father.first_name : '', mother ? mother.first_name : ''].filter(Boolean).join(' ו');
                            return (
                              <div
                                key={m.id}
                                className="p-3 border-b hover:bg-blue-100 cursor-pointer text-right bg-white transition-colors"
                                onClick={() => { setSelectedExistingId(m.id); setExistingSearchQuery(''); }}
                              >
                                <div className="font-bold text-gray-800">{m.first_name} {m.last_name}</div>
                                {parentsStr && <div className="text-xs text-gray-500 mt-1">בן/בת של: {parentsStr}</div>}
                              </div>
                            );
                          })
                        ) : (
                          <div className="p-4 text-center text-gray-500">לא נמצאו דמויות בשם הזה</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col"><label className="text-sm font-bold text-gray-600 mb-1">שם פרטי *</label><input required type="text" value={formData.first_name || ''} onChange={e => setFormData({...formData, first_name: e.target.value})} className="border rounded-lg p-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-400" /></div>
                  <div className="flex flex-col"><label className="text-sm font-bold text-gray-600 mb-1">שם משפחה *</label><input required type="text" value={formData.last_name || ''} onChange={e => setFormData({...formData, last_name: e.target.value})} className="border rounded-lg p-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-400" /></div>
                  <div className="flex flex-col"><label className="text-sm font-bold text-gray-600 mb-1">מגדר</label><select value={formData.gender || 'זכר'} onChange={e => setFormData({...formData, gender: e.target.value})} className="border rounded-lg p-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-400"><option value="זכר">זכר</option><option value="נקבה">נקבה</option></select></div>
                  <div className="flex flex-col"><label className="text-sm font-bold text-gray-600 mb-1">תאריך לידה</label><input type="text" placeholder="למשל: 1980" value={formData.birth_date || ''} onChange={e => setFormData({...formData, birth_date: e.target.value})} className="border rounded-lg p-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-400" /></div>
                  <div className="flex flex-col"><label className="text-sm font-bold text-gray-600 mb-1">מקום לידה</label><input type="text" value={formData.birth_place || ''} onChange={e => setFormData({...formData, birth_place: e.target.value})} className="border rounded-lg p-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-400" /></div>
                  <div className="flex flex-col"><label className="text-sm font-bold text-gray-600 mb-1">עיסוק</label><input type="text" value={formData.occupation || ''} onChange={e => setFormData({...formData, occupation: e.target.value})} className="border rounded-lg p-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-400" /></div>
                  <div className="flex flex-col"><label className="text-sm font-bold text-gray-600 mb-1">תאריך פטירה</label><input type="text" value={formData.death_date || ''} onChange={e => setFormData({...formData, death_date: e.target.value})} className="border rounded-lg p-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-400" /></div>
                  
                  <div className="flex flex-col col-span-2 bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <label className="text-sm font-bold text-gray-700 mb-2">תמונת פרופיל</label>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        {formData.photo_url ? (
                          <img src={formData.photo_url} alt="תמונה קיימת" className="w-12 h-12 rounded-full object-cover border-2 border-blue-400 shadow-sm" />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-500 font-bold">אין תמונה</div>
                        )}
                        <input type="file" accept="image/*" onChange={e => setSelectedImageFile(e.target.files[0])} className="text-sm text-gray-600" />
                      </div>
                      {formData.photo_url && (
                        <button 
                          type="button" 
                          onClick={() => setFormData({ ...formData, photo_url: null })} 
                          className="bg-red-500 text-white font-bold px-4 py-2 rounded-lg text-xs hover:bg-red-600 transition-colors shadow-sm"
                        >
                          🗑️ הסר תמונה
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-col col-span-2"><label className="text-sm font-bold text-gray-600 mb-1">סיפור חיים</label><textarea rows="3" value={formData.life_story || ''} onChange={e => setFormData({...formData, life_story: e.target.value})} className="border rounded-lg p-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-400 custom-scrollbar" /></div>
                </div>
              )}
              <div className="col-span-2 flex justify-end gap-3 mt-6 pt-4 border-t">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2 bg-gray-200 text-gray-700 font-bold rounded-lg hover:bg-gray-300">ביטול</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700">שמור פרטים</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedMember && (
        <div className="w-80 h-full bg-white shadow-2xl border-l border-gray-200 p-6 flex flex-col z-40 relative overflow-y-auto custom-scrollbar">
          <button onClick={() => { setSelectedMember(null); setFocalMemberId(null); }} className="absolute top-4 left-4 text-gray-400 hover:text-red-500 font-bold text-2xl">&times;</button>
          
          <div className="text-center mt-8 mb-6">
            <h2 className="text-2xl font-bold text-gray-800">{selectedMember.first_name} {selectedMember.last_name}</h2>
            <p className="text-gray-500 text-sm mt-1">{selectedMember.birth_date ? `נולד/ה ב-${selectedMember.birth_date}` : ''}</p>
          </div>

          {editMode && (
            <div className="mb-6 flex gap-2 justify-center border-b border-gray-100 pb-4">
              <button onClick={() => openModal('edit', 'עריכת פרטים', selectedMember)} className="bg-blue-100 hover:bg-blue-200 text-blue-700 text-sm font-bold py-1 px-3 rounded">✏️ ערוך פרטים</button>
              <button onClick={handleDelete} className="bg-red-100 hover:bg-red-200 text-red-700 text-sm font-bold py-1 px-3 rounded">🗑️ מחק דמות</button>
            </div>
          )}

          <div className="space-y-4">
            
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
              <h3 className="text-xs text-blue-800 font-bold mb-1 uppercase flex justify-between items-center cursor-pointer select-none" onClick={() => toggleSection('parents')}>
                <span className="flex items-center gap-1">הורים {openSections.parents ? '▼' : '◀'}</span>
                {editMode && (
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    {!selectedMember.father_obj && <button onClick={() => openModal('add_father', 'הוספת אב')} className="text-blue-600 hover:text-blue-900 font-black">+ אב</button>}
                    {!selectedMember.mother_obj && <button onClick={() => openModal('add_mother', 'הוספת אם')} className="text-pink-600 hover:text-pink-900 font-black">+ אם</button>}
                  </div>
                )}
              </h3>
              {openSections.parents && (
                <div className="flex flex-col gap-2 mt-2">
                  {selectedMember.father_obj && (
                    <div className="flex justify-between items-center bg-white p-1.5 rounded border border-blue-200">
                      <button onClick={() => handleSelectMember(selectedMember.father_obj)} className="text-right text-sm text-blue-700 hover:underline">אב: {selectedMember.father_obj.first_name} {selectedMember.father_obj.last_name}</button>
                      {editMode && <button onClick={() => handleUnlink('father', selectedMember.father_obj.id)} className="text-red-500 text-xs px-2 hover:text-red-700">✖</button>}
                    </div>
                  )}
                  {selectedMember.mother_obj && (
                    <div className="flex justify-between items-center bg-white p-1.5 rounded border border-pink-200">
                      <button onClick={() => handleSelectMember(selectedMember.mother_obj)} className="text-right text-sm text-pink-700 hover:underline">אם: {selectedMember.mother_obj.first_name} {selectedMember.mother_obj.last_name}</button>
                      {editMode && <button onClick={() => handleUnlink('mother', selectedMember.mother_obj.id)} className="text-red-500 text-xs px-2 hover:text-red-700">✖</button>}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-purple-50 p-3 rounded-lg border border-purple-100">
              <h3 className="text-xs text-purple-800 font-bold mb-1 uppercase flex justify-between items-center cursor-pointer select-none" onClick={() => toggleSection('spouses')}>
                <span className="flex items-center gap-1">בני/בנות זוג {openSections.spouses ? '▼' : '◀'}</span>
                {editMode && (
                  <button onClick={(e) => { e.stopPropagation(); openModal('add_spouse', 'הוספת בן/בת זוג'); }} className="text-purple-600 hover:text-purple-900 font-black">+</button>
                )}
              </h3>
              {openSections.spouses && (
                <div className="flex flex-col gap-2 mt-2">
                  {getSpouses().map(spouse => (
                    <div key={spouse.id} className="flex justify-between items-center bg-white p-1.5 rounded border border-purple-200">
                      <button onClick={() => handleSelectMember(spouse)} className="text-right text-sm text-purple-700 hover:underline">{spouse.first_name} {spouse.last_name}</button>
                      {editMode && <button onClick={() => handleUnlink('spouse', spouse.id)} className="text-red-500 text-xs px-2 hover:text-red-700">✖</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-green-50 p-3 rounded-lg border border-green-100">
              <h3 className="text-xs text-green-800 font-bold mb-1 uppercase flex justify-between items-center cursor-pointer select-none" onClick={() => toggleSection('children')}>
                <span className="flex items-center gap-1">ילדים ({getChildren().length}) {openSections.children ? '▼' : '◀'}</span>
                {editMode && (
                  <button onClick={(e) => { e.stopPropagation(); openModal('add_child', 'הוספת ילד/ה'); }} className="text-green-600 hover:text-green-900 font-black">+</button>
                )}
              </h3>
              {openSections.children && (
                <div className="flex flex-col gap-2 mt-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                  {getChildren().map(child => (
                    <div key={child.id} className="flex justify-between items-center bg-white p-1.5 rounded border border-green-200">
                      <button onClick={() => handleSelectMember(child)} className="text-right text-sm text-green-700 hover:underline">{child.first_name} {child.last_name}</button>
                      {editMode && <button onClick={() => handleUnlink('child', child.id)} className="text-red-500 text-xs px-2 hover:text-red-700">✖</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-orange-50 p-3 rounded-lg border border-orange-100">
              <h3 className="text-xs text-orange-800 font-bold mb-1 uppercase flex justify-between items-center cursor-pointer select-none" onClick={() => toggleSection('siblings')}>
                <span className="flex items-center gap-1">אחים ואחיות ({getSiblings().length}) {openSections.siblings ? '▼' : '◀'}</span>
                {editMode && (selectedMember.father_id || selectedMember.mother_id) && (
                  <button onClick={(e) => { e.stopPropagation(); openModal('add_sibling', 'הוספת אח/ות'); }} className="text-orange-600 hover:text-orange-900 font-black">+</button>
                )}
              </h3>
              {openSections.siblings && (
                <div className="flex flex-col gap-2 mt-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                  {getSiblings().map(sibling => (
                    <div key={sibling.id} className="flex justify-between items-center bg-white p-1.5 rounded border border-orange-200">
                      <button onClick={() => handleSelectMember(sibling)} className="text-right text-sm text-orange-700 hover:underline">{sibling.first_name} {sibling.last_name}</button>
                      {editMode && <button onClick={() => handleUnlink('sibling', sibling.id)} className="text-red-500 text-xs px-2 hover:text-red-700">✖</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <hr className="border-gray-200" />
            <div><h3 className="text-sm text-gray-500 font-semibold">מקום לידה</h3><p className="text-gray-800">{selectedMember.birth_place || 'לא הוזן'}</p></div>
            <div><h3 className="text-sm text-gray-500 font-semibold">ארץ מוצא</h3><p className="text-gray-800">{selectedMember.origin_country || 'לא הוזן'}</p></div>
            <div><h3 className="text-sm text-gray-500 font-semibold">עיסוק</h3><p className="text-gray-800">{selectedMember.occupation || 'לא הוזן'}</p></div>
            {selectedMember.death_date && (
              <>
                <div><h3 className="text-sm text-gray-500 font-semibold">תאריך פטירה</h3><p className="text-gray-800">{selectedMember.death_date}</p></div>
                <div><h3 className="text-sm text-gray-500 font-semibold">מקום פטירה</h3><p className="text-gray-800">{selectedMember.death_place || 'לא הוזן'}</p></div>
              </>
            )}
            <div><h3 className="text-sm text-gray-500 font-semibold">סיפור חיים</h3><p className="text-gray-800 whitespace-pre-wrap">{selectedMember.life_story || 'לא הוזן'}</p></div>
          </div>
        </div>
      )}

      <div className="flex-grow h-full" dir="ltr">
        <ReactFlow 
          nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} nodesDraggable={isDraggable}
        >
          <Panel position="top-right" className="z-30 m-4 flex flex-col gap-2">
            <button onClick={() => setIsPanelOpen(!isPanelOpen)} className="bg-white/95 p-3 rounded-xl shadow-lg border border-gray-200 text-sm font-bold text-gray-700 hover:bg-gray-50 flex justify-between items-center w-64">
              <span>{isPanelOpen ? '🔽 סגור תפריט כלים' : '⚙️ פתח תפריט כלים וחיפוש'}</span>
            </button>
            
            {isPanelOpen && (
              <div className="bg-white/95 p-4 rounded-xl shadow-lg border border-gray-200 flex flex-col gap-3 w-64">
                
                <div className="relative mb-2">
                  <input 
                    ref={searchInputRef}
                    type="text" 
                    placeholder="חיפוש דמות..." 
                    value={searchQuery} 
                    onChange={(e) => setSearchQuery(e.target.value)} 
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-400 bg-gray-50 text-right" 
                    dir="rtl" 
                  />
                  {searchResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto z-[100] custom-scrollbar" dir="rtl">
                      {searchResults.map(result => {
                        const father = allMembers.find(m => m.id === result.father_id);
                        const mother = allMembers.find(m => m.id === result.mother_id);
                        const parentsStr = [father ? father.first_name : '', mother ? mother.first_name : ''].filter(Boolean).join(' ו');
                        return (
                          <div key={result.id} className="p-3 border-b hover:bg-blue-50 cursor-pointer text-right transition-colors" 
                            onClick={() => { 
                              handleSelectMember(result, allMembers); 
                              setSearchQuery(''); 
                              setSearchResults([]); 
                              setIsPanelOpen(false); // <--- סגירת התפריט בלחיצה!
                            }}>
                            <div className="font-bold text-sm text-gray-800">{result.first_name} {result.last_name}</div>
                            {parentsStr && <div className="text-xs text-gray-500 mt-1">בן/בת של: {parentsStr}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                
                <hr className="border-gray-200" />
                
                {currentUser ? (
                  <button onClick={handleLogout} className="px-4 py-2 rounded-lg text-sm font-bold bg-indigo-500 text-white transition-colors hover:bg-indigo-600 flex items-center justify-center gap-2">
                    🚪 התנתק ממצב עריכה
                  </button>
                ) : (
                  <button onClick={() => setIsLoginOpen(true)} className="px-4 py-2 rounded-lg text-sm font-bold bg-gray-200 text-gray-700 transition-colors hover:bg-gray-300 flex items-center justify-center gap-2">
                    🔐 כנס למצב עריכה
                  </button>
                )}

                {editMode && (
                  <>
                    <hr className="border-gray-200" />
                    <button onClick={() => openModal('add_new', '✨ הוספת דמות חדשה')} className="px-4 py-2 rounded-lg text-sm font-bold bg-green-500 text-white transition-colors hover:bg-green-600 flex items-center justify-center gap-2">
                      ➕ צור דמות חדשה
                    </button>
                  </>
                )}

                <hr className="border-gray-200" />
                <button onClick={() => setIsDraggable(!isDraggable)} className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors flex items-center justify-center gap-2 ${isDraggable ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}>
                  {isDraggable ? '🔒 נעל תצוגה' : '🔓 אפשר תזוזה'}
                </button>
                <button onClick={resetLayout} disabled={!isDraggable} className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors flex items-center justify-center gap-2 ${!isDraggable ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'}`}>
                  🔄 אפס מיקומים
                </button>
                <hr className="border-gray-200" />
                <h3 className="text-xs font-bold text-gray-700 text-right">דורות להצגה מסביב:</h3>
                <div className="flex justify-between items-center bg-gray-100 p-2 rounded-lg">
                  <span className="text-xs text-gray-700 font-semibold">אבות</span>
                  <input type="number" min="0" max="10" value={genUp} onChange={(e) => setGenUp(Number(e.target.value))} className="w-12 text-center text-sm border border-gray-300 rounded p-1" />
                </div>
                <div className="flex justify-between items-center bg-gray-100 p-2 rounded-lg">
                  <span className="text-xs text-gray-700 font-semibold">בנים</span>
                  <input type="number" min="0" max="10" value={genDown} onChange={(e) => setGenDown(Number(e.target.value))} className="w-12 text-center text-sm border border-gray-300 rounded p-1" />
                </div>
              </div>
            )}
          </Panel>

          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <button 
                onClick={() => {
                  setIsPanelOpen(true);
                  setTimeout(() => searchInputRef.current?.focus(), 100);
                }}
                className="pointer-events-auto flex items-center gap-3 bg-white/70 px-8 py-5 rounded-full shadow-md backdrop-blur-sm border border-gray-200 hover:border-blue-400 hover:scale-105 hover:shadow-lg transition-all cursor-pointer"
                dir="rtl"
              >
                <span className="text-3xl text-gray-600">🔍</span>
                <span className="text-2xl md:text-3xl font-bold text-gray-600">חפש דמות כדי להתחיל...</span>
              </button>
            </div>
          )}

          <Background color="#f3f4f6" gap={20} size={1} />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <ReactFlowProvider>
      <FamilyTreeApp />
    </ReactFlowProvider>
  );
}