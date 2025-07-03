import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, onSnapshot, query, where, deleteDoc, setDoc } from 'firebase/firestore';
import * as Tone from 'tone'; // Import Tone.js

// Define Firebase configuration and app ID from global variables
// These variables are provided by the Canvas environment for direct execution.
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-lifequest-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Tone.js instruments for sound effects
const successSynth = new Tone.Synth().toDestination();
const goldSynth = new Tone.MembraneSynth().toDestination();
const punishmentSynth = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0.05, release: 0.1 }
}).toDestination();
const pomodoroBell = new Tone.MetalSynth({
    frequency: 400,
    envelope: { attack: 0.001, decay: 1.4, release: 0.2 },
    harmonicity: 5.1,
    metallicity: 0.8,
    octaves: 10
}).toDestination();

// Main App Component
const App = () => {
    // State for Firebase instances and user ID
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [loading, setLoading] = useState(true); // Loading state for initial setup

    // State for objectives and form
    const [objectives, setObjectives] = useState([]);
    const [showObjectiveForm, setShowObjectiveForm] = useState(false);
    const [editingObjective, setEditingObjective] = useState(null); // Objective being edited
    const [currentObjective, setCurrentObjective] = useState(null); // Currently selected objective

    // State for player stats
    const [playerStats, setPlayerStats] = useState({
        level: 1,
        xp: 0,
        xpToNextLevel: 100, // XP needed to reach the next level
        gold: 0, // Gold currency
        vitality: 100, // Renamed from HP to Vitality
        maxVitality: 100,
        currentSatisfaction: 50, // New: Satisfaction meter
        satisfactionHistory: [], // New: History of satisfaction
        lastDailyRewardClaim: null, // Timestamp of last claim
        currentStreak: 0, // New: Daily activity streak
        lastStreakDate: null, // New: Date of last streak update
        achievements: [], // New: List of unlocked achievements
        hasCompletedTutorial: false, // New: Flag for tutorial completion
        pomodoroCount: 0, // New: Track total pomodoro sessions completed
        dailyDesireCount: 0, // New: Track total daily desires completed
    });

    // State for LLM features and subtasks
    const [subtasks, setSubtasks] = useState([]); // Subtasks for the current objective
    const [newSubtaskText, setNewSubtaskText] = useState(''); // For manual subtask input
    const [isGeneratingSubtasks, setIsGeneratingSubtasks] = useState(false);
    const [motivationalAdvice, setMotivationalAdvice] = useState('');
    const [isGettingAdvice, setIsGettingAdvice] = useState(false);
    const [realWorldAdvice, setRealWorldAdvice] = useState(''); // For real-world advice from Gemini
    const [isGettingRealWorldAdvice, setIsGettingRealWorldAdvice] = useState(false);
    const [realWorldPrompt, setRealWorldPrompt] = useState(''); // Input for real-world advice prompt
    const [obstacleAdvice, setObstacleAdvice] = useState(''); // New: For obstacle advice from Gemini
    const [isGettingObstacleAdvice, setIsGettingObstacleAdvice] = useState(false);
    const [obstaclePrompt, setObstaclePrompt] = useState(''); // New: Input for obstacle advice prompt
    const [objectiveNarrative, setObjectiveNarrative] = useState(''); // New: For objective completion narrative
    const [showObjectiveNarrativeModal, setShowObjectiveNarrativeModal] = useState(false); // New: Control modal visibility
    const [personalizedSuggestions, setPersonalizedSuggestions] = useState(''); // New: For personalized reward/punishment suggestions
    const [isGettingSuggestions, setIsGettingSuggestions] = useState(false);
    const [dailyAffirmation, setDailyAffirmation] = useState(''); // New: For daily affirmation
    const [isGettingAffirmation, setIsGettingAffirmation] = useState(false);


    // State for onboarding screen
    const [showOnboarding, setShowOnboarding] = useState(false); // Control onboarding screen visibility
    // State for tutorial screen
    const [showTutorial, setShowTutorial] = useState(false); // New: Control tutorial screen visibility

    // State for messages/notifications
    const [message, setMessage] = useState('');
    const messageTimeoutRef = useRef(null); // Ref for message timeout

    // State for Pomodoro timer
    const [pomodoroTime, setPomodoroTime] = useState(25 * 60); // 25 minutes in seconds
    const [isPomodoroRunning, setIsPomodoroRunning] = useState(false);
    const [pomodoroInterval, setPomodoroInterval] = useState(null);

    // State for daily desire
    const [dailyDesire, setDailyDesire] = useState(null);
    const [isGeneratingDailyDesire, setIsGeneratingDailyDesire] = useState(false);

    // State for navigation
    const [activeTab, setActiveTab] = useState('missions'); // 'missions', 'profile', 'rewards', 'achievements'

    // New: State for image generation
    const [generatedAvatarImageUrl, setGeneratedAvatarImageUrl] = useState(null);
    const [isGeneratingAvatarImage, setIsGeneratingAvatarImage] = useState(false);
    const [generatedAchievementImageUrl, setGeneratedAchievementImageUrl] = useState(null);
    const [isGeneratingAchievementImage, setIsGeneratingAchievementImage] = useState(false);
    const [selectedAchievementForImage, setSelectedAchievementForImage] = useState(null);


    // Function to show temporary messages
    const showMessage = (msg) => {
        setMessage(msg);
        if (messageTimeoutRef.current) {
            clearTimeout(messageTimeoutRef.current);
        }
        messageTimeoutRef.current = setTimeout(() => {
            setMessage('');
        }, 3000); // Message disappears after 3 seconds
    };

    // Initialize Firebase and handle authentication
    useEffect(() => {
        const initializeFirebase = async () => {
            try {
                const app = initializeApp(firebaseConfig);
                const firestoreDb = getFirestore(app);
                const firebaseAuth = getAuth(app);

                setDb(firestoreDb);
                setAuth(firebaseAuth);

                // Listen for auth state changes
                onAuthStateChanged(firebaseAuth, async (user) => {
                    if (user) {
                        setUserId(user.uid);
                        console.log("User authenticated:", user.uid);
                    } else {
                        // Sign in anonymously if no custom token or if user logs out
                        if (initialAuthToken) {
                            await signInWithCustomToken(firebaseAuth, initialAuthToken);
                            console.log("Signed in with custom token.");
                        } else {
                            await signInAnonymously(firebaseAuth);
                            console.log("Signed in anonymously.");
                        }
                    }
                    setLoading(false); // Authentication is ready
                });

            } catch (error) {
                console.error("Error initializing Firebase:", error);
                showMessage("Error al inicializar la aplicación. Intenta de nuevo.");
                setLoading(false);
            }
        };

        initializeFirebase();

        // Cleanup timeout on unmount
        return () => {
            if (messageTimeoutRef.current) {
                clearTimeout(messageTimeoutRef.current);
            }
        };
    }, []); // Run once on component mount

    // Fetch and listen for real-time updates to objectives and player stats
    useEffect(() => {
        if (!db || !userId) {
            return; // Don't fetch if Firebase or user is not ready
        }

        // --- Objectives Listener ---
        const objectivesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/objectives`);
        const qObjectives = query(objectivesCollectionRef);

        const unsubscribeObjectives = onSnapshot(qObjectives, (snapshot) => {
            const fetchedObjectives = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setObjectives(fetchedObjectives);
            // Update current objective state if it changed
            const activeObjective = fetchedObjectives.find(obj => obj.isCurrent);
            setCurrentObjective(activeObjective || null);

            // Determine whether to show onboarding or tutorial
            if (fetchedObjectives.length === 0 && !loading) {
                setShowOnboarding(true);
                setShowTutorial(false); // Ensure tutorial is not shown during onboarding
            } else if (fetchedObjectives.length > 0 && !playerStats.hasCompletedTutorial && !loading) {
                setShowOnboarding(false);
                setShowTutorial(true); // Show tutorial if objectives exist but tutorial not completed
            } else {
                setShowOnboarding(false);
                setShowTutorial(false);
            }

            console.log("Objectives updated:", fetchedObjectives);
        }, (error) => {
            console.error("Error fetching objectives:", error);
            showMessage("Error al cargar objetivos.");
        });

        // --- Player Stats Listener ---
        const playerStatsDocRef = doc(db, `artifacts/${appId}/users/${userId}/playerStats`, 'mainStats');
        const unsubscribePlayerStats = onSnapshot(playerStatsDocRef, (docSnap) => {
            if (docSnap.exists()) {
                setPlayerStats(prevStats => {
                    const fetchedData = docSnap.data();
                    const newStats = {
                        ...prevStats,
                        ...fetchedData,
                        // Ensure satisfactionHistory is always an array, even if missing from fetchedData
                        satisfactionHistory: fetchedData.satisfactionHistory || [],
                    };
                    // Re-evaluate tutorial visibility based on updated playerStats
                    if (objectives.length > 0 && !newStats.hasCompletedTutorial && !loading) {
                        setShowTutorial(true);
                    } else {
                        setShowTutorial(false);
                    }
                    return newStats;
                });
                console.log("Player stats updated:", docSnap.data());
            } else {
                // If player stats don't exist, create initial ones
                console.log("No player stats found, creating initial stats.");
                setDoc(playerStatsDocRef, playerStats); // Use initial playerStats state
            }
        }, (error) => {
            console.error("Error fetching player stats:", error);
            showMessage("Error al cargar estadísticas del jugador.");
        });


        // Cleanup listeners on component unmount or when db/userId changes
        return () => {
            unsubscribeObjectives();
            unsubscribePlayerStats();
        };
    }, [db, userId, loading, playerStats.hasCompletedTutorial, objectives.length]); // Re-run when db, userId, or loading changes

    // Fetch and listen for real-time updates to subtasks of the current objective
    useEffect(() => {
        if (!db || !userId || !currentObjective) {
            setSubtasks([]); // Clear subtasks if no current objective
            return;
        }

        const subtasksCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/objectives/${currentObjective.id}/subtasks`);
        const qSubtasks = query(subtasksCollectionRef);

        const unsubscribeSubtasks = onSnapshot(qSubtasks, (snapshot) => {
            const fetchedSubtasks = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setSubtasks(fetchedSubtasks);
            console.log("Subtasks updated for current objective:", fetchedSubtasks);
        }, (error) => {
            console.error("Error fetching subtasks:", error);
            showMessage("Error al cargar subtareas.");
        });

        return () => unsubscribeSubtasks();
    }, [db, userId, currentObjective]); // Re-run when db, userId, or currentObjective changes

    // Function to update player stats in Firestore
    const updatePlayerStats = async (newStats) => {
        if (!db || !userId) return;
        try {
            const playerStatsDocRef = doc(db, `artifacts/${appId}/users/${userId}/playerStats`, 'mainStats');
            console.log("Attempting to save player stats:", newStats); // Added for debugging
            await setDoc(playerStatsDocRef, newStats, { merge: true }); // Merge to update specific fields
            console.log("Player stats saved successfully."); // Added for debugging
        } catch (error) {
            console.error("Error updating player stats:", error);
            showMessage("Error al guardar estadísticas del jugador.");
        }
    };

    // Add XP and handle level up
    const addXp = (amount) => {
        setPlayerStats(prevStats => {
            let newXp = prevStats.xp + amount;
            let newLevel = prevStats.level;
            let newXpToNextLevel = prevStats.xpToNextLevel;

            // Level up logic
            while (newXp >= newXpToNextLevel) {
                newXp -= newXpToNextLevel; // Subtract XP for current level
                newLevel += 1; // Increment level
                newXpToNextLevel = Math.floor(newXpToNextLevel * 1.5); // Increase XP needed for next level
                showMessage(`¡Felicidades! Has alcanzado el Nivel ${newLevel}!`);
                successSynth.triggerAttackRelease("C5", "8n"); // Play sound on level up
                checkAchievements('levelUp', newLevel); // Check for level-up achievements
            }

            const updatedStats = {
                ...prevStats,
                xp: newXp,
                level: newLevel,
                xpToNextLevel: newXpToNextLevel,
            };
            updatePlayerStats(updatedStats); // Save to Firestore
            return updatedStats;
        });
    };

    // Deduct XP
    const deductXp = (amount) => {
        setPlayerStats(prevStats => {
            const newXp = Math.max(0, prevStats.xp - amount); // Ensure XP doesn't go below 0
            const updatedStats = {
                ...prevStats,
                xp: newXp,
            };
            updatePlayerStats(updatedStats);
            return updatedStats;
        });
    };

    // Add Gold
    const addGold = (amount) => {
        setPlayerStats(prevStats => {
            const updatedStats = {
                ...prevStats,
                gold: prevStats.gold + amount,
            };
            updatePlayerStats(updatedStats);
            goldSynth.triggerAttackRelease("C4", "16n"); // Play sound on gold gain
            return updatedStats;
        });
    };

    // Deduct Gold
    const deductGold = (amount) => {
        setPlayerStats(prevStats => {
            const newGold = Math.max(0, prevStats.gold - amount); // Ensure Gold doesn't go below 0
            const updatedStats = {
                ...prevStats,
                gold: newGold,
            };
            updatePlayerStats(updatedStats);
            return updatedStats;
        });
    };

    // Add Vitality (can't go above maxVitality)
    const addVitality = (amount) => {
        setPlayerStats(prevStats => {
            const newVitality = Math.min(prevStats.maxVitality, prevStats.vitality + amount);
            const updatedStats = {
                ...prevStats,
                vitality: newVitality,
            };
            updatePlayerStats(updatedStats);
            return updatedStats;
        });
    };

    // Deduct Vitality
    const deductVitality = (amount) => {
        setPlayerStats(prevStats => {
            const newVitality = Math.max(0, prevStats.vitality - amount); // Ensure Vitality doesn't go below 0
            const updatedStats = {
                ...prevStats,
                vitality: newVitality,
            };
            updatePlayerStats(updatedStats);
            punishmentSynth.triggerAttackRelease("8n"); // Play sound on vitality loss
            // Optionally add a "Game Over" or "Rest" mechanic if Vitality reaches 0
            if (newVitality === 0) {
                showMessage("¡Tu Vitalidad ha llegado a 0! Necesitas descansar.");
                // Future: Implement a "rest" mechanic to restore Vitality
            }
            return updatedStats;
        });
    };

    // Update Satisfaction
    const updateSatisfaction = (newSatisfaction) => {
        setPlayerStats(prevStats => {
            const clampedSatisfaction = Math.min(100, Math.max(0, newSatisfaction));
            const today = new Date().toISOString().split('T')[0];
            
            // Check if there's already an entry for today
            const lastEntryIndex = prevStats.satisfactionHistory.findIndex(entry => entry.date === today);
            let updatedHistory;

            if (lastEntryIndex !== -1) {
                // Update existing entry for today
                updatedHistory = prevStats.satisfactionHistory.map((entry, index) =>
                    index === lastEntryIndex ? { ...entry, value: clampedSatisfaction } : entry
                );
            } else {
                // Add new entry for today
                updatedHistory = [...prevStats.satisfactionHistory, { date: today, value: clampedSatisfaction }];
            }

            // Keep only the last 30 days
            updatedHistory = updatedHistory.slice(-30);

            const updatedStats = {
                ...prevStats,
                currentSatisfaction: clampedSatisfaction,
                satisfactionHistory: updatedHistory
            };
            updatePlayerStats(updatedStats);
            return updatedStats;
        });
    };


    // Add or Update an Objective
    const handleSaveObjective = async (objectiveData) => {
        if (!db || !userId) {
            showMessage("La aplicación no está lista. Intenta de nuevo.");
            return null; // Return null if app not ready
        }

        try {
            let objectiveId;
            if (editingObjective) {
                // Update existing objective
                const objectiveRef = doc(db, `artifacts/${appId}/users/${userId}/objectives`, editingObjective.id);
                await updateDoc(objectiveRef, objectiveData);
                objectiveId = editingObjective.id;
                showMessage("¡Objetivo actualizado con éxito!");
            } else {
                // Add new objective
                const docRef = await addDoc(collection(db, `artifacts/${appId}/users/${userId}/objectives`), {
                    ...objectiveData,
                    isCurrent: false, // New objectives are not current by default
                    isCompleted: false,
                    currentProgress: 0, // New: current progress for the objective
                    totalProgress: objectiveData.totalProgress || 100, // Ensure totalProgress is set
                    xpReward: 50 + (objectiveData.difficulty === 'Difícil' ? 50 : 0) + (objectiveData.difficulty === 'Épico' ? 100 : 0), // XP reward based on difficulty
                    createdAt: new Date(),
                });
                objectiveId = docRef.id;
                showMessage("¡Objetivo creado con éxito!");
            }
            setShowObjectiveForm(false);
            setEditingObjective(null);
            return objectiveId; // Return the ID of the saved/updated objective
        } catch (e) {
            console.error("Error saving objective: ", e);
            showMessage("Error al guardar el objetivo.");
            return null;
        }
    };

    // Select an Objective as Current
    const handleSelectObjective = async (selectedObjectiveId) => {
        if (!db || !userId) {
            showMessage("La aplicación no está lista. Intenta de nuevo.");
            return;
        }

        try {
            // First, set all other objectives to not current
            const batchUpdates = [];
            objectives.forEach(async (obj) => {
                if (obj.isCurrent && obj.id !== selectedObjectiveId) {
                    const objRef = doc(db, `artifacts/${appId}/users/${userId}/objectives`, obj.id);
                    batchUpdates.push(updateDoc(objRef, { isCurrent: false }));
                }
            });
            await Promise.all(batchUpdates); // Execute all updates concurrently

            // Then, set the selected objective as current
            const selectedObjRef = doc(db, `artifacts/${appId}/users/${userId}/objectives`, selectedObjectiveId);
            await updateDoc(selectedObjRef, { isCurrent: true });
            showMessage("¡Objetivo actual seleccionado!");
            // Subtasks will be fetched by the useEffect for currentObjective
        } catch (e) {
            console.error("Error selecting objective: ", e);
            showMessage("Error al seleccionar el objetivo.");
        }
    };

    // Mark an Objective as Completed (New functionality)
    const handleCompleteObjective = async (objectiveId) => {
        if (!db || !userId) {
            showMessage("La aplicación no está lista. Intenta de nuevo.");
            return;
        }

        const objectiveToComplete = objectives.find(obj => obj.id === objectiveId);
        if (!objectiveToComplete) return;

        // Ensure current progress meets total progress
        if (objectiveToComplete.currentProgress < objectiveToComplete.totalProgress) {
            showMessage("¡Aún no has completado este objetivo! Completa más subtareas.");
            return;
        }

        try {
            const objRef = doc(db, `artifacts/${appId}/users/${userId}/objectives`, objectiveId);
            await updateDoc(objRef, {
                isCompleted: true,
                isCurrent: false, // Ensure it's no longer current
                completedAt: new Date(),
            });
            addXp(objectiveToComplete.xpReward); // Grant XP reward
            addGold(objectiveToComplete.xpReward * 2); // Grant Gold reward (e.g., 2x XP)
            showMessage(`¡Misión "${objectiveToComplete.name}" completada! Has ganado ${objectiveToComplete.xpReward} XP y ${objectiveToComplete.xpReward * 2} Oro.`);
            successSynth.triggerAttackRelease("G5", "8n"); // Play sound on objective completion
            checkAchievements('objectiveCompleted', objectiveToComplete.id); // Check for objective completion achievements

            // Generate narrative for objective completion
            await generateObjectiveCompletionNarrative(objectiveToComplete);

            // Optionally, delete or archive subtasks for the completed objective
            const subtasksRef = collection(db, `artifacts/${appId}/users/${userId}/objectives/${objectiveId}/subtasks`);
            const subtaskDocs = await getDocs(subtasksRef);
            const deletePromises = subtaskDocs.docs.map(sDoc => deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/objectives/${objectiveId}/subtasks`, sDoc.id)));
            await Promise.all(deletePromises);
            setSubtasks([]); // Clear local subtasks state
        } catch (e) {
            console.error("Error completing objective: ", e);
            showMessage("Error al completar el objetivo.");
        }
    };

    // Delete an Objective
    const handleDeleteObjective = async (objectiveId) => {
        if (!db || !userId) {
            showMessage("La aplicación no está lista. Intenta de nuevo.");
            return;
        }

        showMessage("Eliminando objetivo y sus subtareas...");
        try {
            // Delete subtasks first
            const subtasksRef = collection(db, `artifacts/${appId}/users/${userId}/objectives/${objectiveId}/subtasks`);
            const subtaskDocs = await getDocs(subtasksRef);
            const deleteSubtaskPromises = subtaskDocs.docs.map(sDoc => deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/objectives/${objectiveId}/subtasks`, sDoc.id)));
            await Promise.all(deleteSubtaskPromises);

            // Then delete the objective
            await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/objectives`, objectiveId));
            showMessage("Objetivo y subtareas eliminados.");
        } catch (e) {
            console.error("Error deleting objective: ", e);
            showMessage("Error al eliminar el objetivo.");
        }
    };

    // Subtask Management Functions
    const handleAddSubtask = async (text, xpReward = 10, progressContribution = 10, goldReward = 5, dueDate = null) => {
        if (!db || !userId || !currentObjective) {
            showMessage("Selecciona un objetivo actual para añadir subtareas.");
            return;
        }
        if (!text.trim()) {
            showMessage("La subtarea no puede estar vacía.");
            return;
        }

        try {
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/objectives/${currentObjective.id}/subtasks`), {
                text,
                isCompleted: false,
                xpReward,
                progressContribution,
                goldReward, // New: gold reward for subtask
                dueDate, // New: due date for subtask
                createdAt: new Date(),
            });
            setNewSubtaskText(''); // Clear input field
            showMessage("Subtarea añadida.");
        } catch (e) {
            console.error("Error adding subtask:", e);
            showMessage("Error al añadir subtarea.");
        }
    };

    const handleToggleSubtaskComplete = async (subtaskId, isCompleted) => {
        if (!db || !userId || !currentObjective) {
            showMessage("La aplicación no está lista.");
            return;
        }

        const subtaskRef = doc(db, `artifacts/${appId}/users/${userId}/objectives/${currentObjective.id}/subtasks`, subtaskId);
        const subtaskToUpdate = subtasks.find(st => st.id === subtaskId);

        if (!subtaskToUpdate) return;

        try {
            await updateDoc(subtaskRef, { isCompleted: !isCompleted });

            // Update objective progress and player XP/Gold if marking as complete
            if (!isCompleted) { // If it was incomplete and now is complete
                const newProgress = currentObjective.currentProgress + subtaskToUpdate.progressContribution;
                await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/objectives`, currentObjective.id), {
                    currentProgress: Math.min(newProgress, currentObjective.totalProgress) // Cap progress at totalProgress
                });
                addXp(subtaskToUpdate.xpReward);
                addGold(subtaskToUpdate.goldReward); // Grant gold
                showMessage(`¡Subtarea completada! +${subtaskToUpdate.progressContribution} Progreso, +${subtaskToUpdate.xpReward} XP, +${subtaskToUpdate.goldReward} Oro.`);
                successSynth.triggerAttackRelease("C4", "16n"); // Play sound on subtask completion
                checkAchievements('subtaskCompleted', subtaskToUpdate.id); // Check for subtask completion achievements
                checkDailyStreak(); // Check and update daily streak
            } else { // If it was complete and now is incomplete (undo)
                const newProgress = currentObjective.currentProgress - subtaskToUpdate.progressContribution;
                await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/objectives`, currentObjective.id), {
                    currentProgress: Math.max(newProgress, 0) // Don't go below 0
                });
                deductXp(subtaskToUpdate.xpReward); // Deduct XP
                deductGold(subtaskToUpdate.goldReward); // Deduct Gold
                showMessage(`Subtarea marcada como incompleta. -${subtaskToUpdate.progressContribution} Progreso, -${subtaskToUpdate.xpReward} XP, -${subtaskToUpdate.goldReward} Oro.`);
            }
        } catch (e) {
            console.error("Error toggling subtask complete:", e);
            showMessage("Error al actualizar subtarea.");
        }
    };

    const handleDeleteSubtask = async (subtaskId) => {
        if (!db || !userId || !currentObjective) {
            showMessage("La aplicación no está lista.");
            return;
        }

        showMessage("Eliminando subtarea...");
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/objectives/${currentObjective.id}/subtasks`, subtaskId));
            showMessage("Subtarea eliminada.");
        } catch (e) {
            console.error("Error deleting subtask:", e);
            showMessage("Error al eliminar subtarea.");
        }
    };


    // LLM Integration: Generate Subtasks
    const generateSubtasks = async (objectiveIdToUpdate = null, subtaskPrompt = null) => {
        const targetObjective = objectiveIdToUpdate ? objectives.find(obj => obj.id === objectiveIdToUpdate) : currentObjective;

        if (!targetObjective) {
            showMessage("Por favor, selecciona un objetivo actual o asegúrate de que el objetivo inicial se haya creado.");
            return;
        }
        setIsGeneratingSubtasks(true);

        const prompt = subtaskPrompt || `Genera una lista de 5 a 7 subtareas concretas y accionables para el siguiente objetivo épico:
        Nombre: ${targetObjective.name}
        Descripción: ${targetObjective.description}
        Dificultad: ${targetObjective.difficulty}

        Para cada subtarea, asigna una cantidad de XP (entre 5 y 20) y Oro (entre 3 y 15) basándote en la dificultad percibida de la subtarea. Las tareas más difíciles deben dar más XP y Oro. Responde en formato JSON con un array de objetos, donde cada objeto tiene 'text', 'xpReward' y 'goldReward'.`;

        try {
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            const payload = {
                contents: chatHistory,
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                "text": { "type": "STRING" },
                                "xpReward": { "type": "NUMBER" },
                                "goldReward": { "type": "NUMBER" }
                            },
                            required: ["text", "xpReward", "goldReward"]
                        }
                    }
                }
            };
            const apiKey = ""; // If you want to use models other than gemini-2.0-flash or imagen-3.0-generate-002, provide an API key here. Otherwise, leave this as-is.
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const json = result.candidates[0].content.parts[0].text;
                const parsedSubtasks = JSON.parse(json);
                // Add generated subtasks to Firestore for the specified objective
                for (const taskData of parsedSubtasks) { // Iterate over objects, not just strings
                    await addDoc(collection(db, `artifacts/${appId}/users/${userId}/objectives/${targetObjective.id}/subtasks`), {
                        text: taskData.text,
                        isCompleted: false,
                        xpReward: taskData.xpReward || 10, // Use generated or default
                        progressContribution: 10, // Keep fixed for now
                        goldReward: taskData.goldReward || 5, // Use generated or default
                        dueDate: null,
                        createdAt: new Date(),
                    });
                }
                showMessage("¡Subtareas generadas y añadidas!");
            } else {
                showMessage("No se pudieron generar las subtareas. Intenta de nuevo.");
                console.error("Unexpected API response structure:", result);
            }
        } catch (error) {
            console.error("Error generating subtasks:", error);
            showMessage("Error al generar subtareas.");
        } finally {
            setIsGeneratingSubtasks(false);
        }
    };

    // LLM Integration: Get Motivational Advice
    const getMotivationalAdvice = async () => {
        setIsGettingAdvice(true);
        setMotivationalAdvice(''); // Clear previous advice

        const prompt = currentObjective
            ? `Dame un consejo motivacional corto y en español (máximo 50 palabras) para mi objetivo de "${currentObjective.name}" que tiene la siguiente descripción: "${currentObjective.description}".`
            : `Dame un consejo motivacional corto y en español (máximo 50 palabras) para alguien que busca mejorar su vida y alcanzar sus metas.`;

        try {
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            const payload = { contents: chatHistory };
            const apiKey = ""; // If you want to use models other than gemini-2.0-flash or imagen-3.0-generate-002, provide an API key here. Otherwise, leave this as-is.
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                setMotivationalAdvice(text);
                showMessage("¡Consejo recibido!");
            } else {
                showMessage("No se pudo obtener el consejo. Intenta de nuevo.");
                console.error("Unexpected API response structure:", result);
            }
        } catch (error) {
            console.error("Error getting motivational advice:", error);
            showMessage("Error al obtener consejo.");
        } finally {
            setIsGettingAdvice(false);
        }
    };

    // LLM Integration: Get Real-World Advice
    const getRealWorldAdvice = async () => {
        if (!realWorldPrompt.trim()) {
            showMessage("Por favor, escribe tu pregunta para Gemini.");
            return;
        }
        setIsGettingRealWorldAdvice(true);
        setRealWorldAdvice('');

        const prompt = `Responde a la siguiente pregunta de un usuario sobre cómo completar una tarea en la vida real o sobre estabilidad económica, de forma concisa y útil (máximo 100 palabras): "${realWorldPrompt}". Si la pregunta es sobre estabilidad económica, incluye pasos básicos para lograrla.`;

        try {
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            const payload = { contents: chatHistory };
            const apiKey = ""; // If you want to use models other than gemini-2.0-flash or imagen-3.0-generate-002, provide an API key here. Otherwise, leave this as-is.
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                setRealWorldAdvice(text);
                showMessage("¡Respuesta de Gemini recibida!");
            } else {
                showMessage("No se pudo obtener la respuesta de Gemini. Intenta de nuevo.");
                console.error("Unexpected API response structure:", result);
            }
        } catch (error) {
            console.error("Error getting real-world advice:", error);
            showMessage("Error al obtener el consejo de Gemini.");
        } finally {
            setIsGettingRealWorldAdvice(false);
        }
    };

    // New LLM Integration: Get Obstacle Advice
    const getObstacleAdvice = async () => {
        if (!obstaclePrompt.trim() || !currentObjective) {
            showMessage("Por favor, describe tu obstáculo y asegúrate de tener una misión actual.");
            return;
        }
        setIsGettingObstacleAdvice(true);
        setObstacleAdvice('');

        const prompt = `Estoy trabajando en la subtarea: "${obstaclePrompt}" para mi objetivo principal: "${currentObjective.name}". Dame ideas o estrategias concisas (máximo 100 palabras) para superar este obstáculo.`;

        try {
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            const payload = { contents: chatHistory };
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                setObstacleAdvice(text);
                showMessage("¡Consejo para el obstáculo recibido!");
            } else {
                showMessage("No se pudo obtener el consejo para el obstáculo. Intenta de nuevo.");
                console.error("Unexpected API response structure:", result);
            }
        } catch (error) {
            console.error("Error getting obstacle advice:", error);
            showMessage("Error al obtener el consejo para el obstáculo.");
        } finally {
            setIsGettingObstacleAdvice(false);
        }
    };

    // New LLM Integration: Generate Objective Completion Narrative
    const generateObjectiveCompletionNarrative = async (objective) => {
        const prompt = `Genera una narrativa corta y épica (máximo 100 palabras) sobre la finalización del siguiente objetivo:
        Nombre del Objetivo: ${objective.name}
        Descripción: ${objective.description}
        Dificultad: ${objective.difficulty}
        Incluye un mensaje de felicitación y el impacto de su logro en su "vida de aventurero".`;

        try {
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            const payload = { contents: chatHistory };
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                setObjectiveNarrative(text);
                setShowObjectiveNarrativeModal(true); // Show the modal
            } else {
                console.error("Unexpected API response structure for narrative:", result);
            }
        } catch (error) {
            console.error("Error generating objective narrative:", error);
        }
    };

    // New LLM Integration: Get Personalized Suggestions for Rewards/Punishments
    const getPersonalizedSuggestions = async (type) => {
        setIsGettingSuggestions(true);
        setPersonalizedSuggestions('');

        const prompt = `Soy un aventurero en LifeQuest. Mi nivel actual es ${playerStats.level}, tengo ${playerStats.gold} de Oro y mi vitalidad es ${playerStats.vitality}. Mi objetivo actual es "${currentObjective?.name || 'ninguno'}".
        Sugiere 3 ideas ${type === 'rewards' ? 'de recompensas' : 'de castigos'} personalizadas y creativas (máximo 150 palabras en total) que pueda aplicar en mi vida real, basadas en mi estado actual. Si es recompensa, que sea algo motivador. Si es castigo, que sea algo que me ayude a reflexionar y mejorar, no solo punitivo.`;

        try {
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            const payload = { contents: chatHistory };
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                setPersonalizedSuggestions(text);
                showMessage("¡Sugerencias de Gemini recibidas!");
            } else {
                showMessage("No se pudieron obtener sugerencias. Intenta de nuevo.");
                console.error("Unexpected API response structure:", result);
            }
        } catch (error) {
            console.error("Error getting personalized suggestions:", error);
            showMessage("Error al obtener sugerencias.");
        } finally {
            setIsGettingSuggestions(false);
        }
    };

    // New LLM Integration: Generate Daily Affirmation
    const getDailyAffirmation = async () => {
        setIsGettingAffirmation(true);
        setDailyAffirmation('');

        const prompt = `Genera una afirmación diaria positiva y motivadora en español (máximo 30 palabras), considerando que el usuario está en un juego de rol de vida y su objetivo actual es "${currentObjective?.name || 'mejorar su vida'}" y su nivel es ${playerStats.level}.`;

        try {
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            const payload = { contents: chatHistory };
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                setDailyAffirmation(text);
                showMessage("¡Afirmación diaria recibida!");
            } else {
                showMessage("No se pudo obtener la afirmación diaria. Intenta de nuevo.");
                console.error("Unexpected API response structure:", result);
            }
        } catch (error) {
            console.error("Error getting daily affirmation:", error);
            showMessage("Error al obtener la afirmación.");
        } finally {
            setIsGettingAffirmation(false);
        }
    };


    // New LLM Integration: Generate Daily Desire
    const generateDailyDesire = useCallback(async () => {
        if (!db || !userId) return;

        const today = new Date().toISOString().split('T')[0];
        // Check if a desire was already generated today
        if (dailyDesire && dailyDesire.date === today) {
            return;
        }

        setIsGeneratingDailyDesire(true);
        const prompt = `Genera un "deseo diario" o "mini-misión" para un juego de rol de vida. Debe ser una tarea pequeña, divertida y que promueva una vida saludable o el bienestar. Responde en formato JSON con un objeto que contenga 'text', 'xpReward', 'goldReward', 'timeLimitMinutes'. Ejemplo: {"text": "Beber 8 vasos de agua", "xpReward": 5, "goldReward": 3, "timeLimitMinutes": 1440}. El timeLimitMinutes debe ser 1440 para un día.`;

        try {
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            const payload = {
                contents: chatHistory,
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: {
                            "text": { "type": "STRING" },
                            "xpReward": { "type": "NUMBER" },
                            "goldReward": { "type": "NUMBER" },
                            "timeLimitMinutes": { "type": "NUMBER" }
                        },
                        required: ["text", "xpReward", "goldReward", "timeLimitMinutes"]
                    }
                }
            };
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const json = result.candidates[0].content.parts[0].text;
                const parsedDesire = JSON.parse(json);
                setDailyDesire({ ...parsedDesire, date: today, completed: false });
                showMessage("¡Nuevo deseo diario disponible!");
            } else {
                showMessage("No se pudo generar el deseo diario.");
                console.error("Unexpected API response structure for daily desire:", result);
            }
        } catch (error) {
            console.error("Error generating daily desire:", error);
            showMessage("Error al generar deseo diario.");
        } finally {
            setIsGeneratingDailyDesire(false);
        }
    }, [db, userId, dailyDesire]); // Dependency on dailyDesire to prevent re-generation

    // Effect to generate daily desire on app load if not already generated
    useEffect(() => {
        if (db && userId && !dailyDesire && !isGeneratingDailyDesire) {
            generateDailyDesire();
        }
    }, [db, userId, dailyDesire, isGeneratingDailyDesire, generateDailyDesire]);


    // Function to complete daily desire
    const handleCompleteDailyDesire = () => {
        if (dailyDesire && !dailyDesire.completed) {
            addXp(dailyDesire.xpReward);
            addGold(dailyDesire.goldReward);
            setDailyDesire(prev => ({ ...prev, completed: true }));
            showMessage(`¡Deseo diario completado! +${dailyDesire.xpReward} XP, +${dailyDesire.goldReward} Oro.`);
            successSynth.triggerAttackRelease("C4", "16n"); // Play sound
            checkAchievements('dailyDesireCompleted');
        }
    };


    // Function to claim daily reward (with cooldown)
    const handleClaimDailyReward = () => {
        const now = new Date().getTime();
        const lastClaim = playerStats.lastDailyRewardClaim;
        const twentyFourHours = 24 * 60 * 60 * 1000;

        if (lastClaim && (now - lastClaim < twentyFourHours)) {
            const timeLeft = twentyFourHours - (now - lastClaim);
            const hours = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            showMessage(`Puedes reclamar tu próxima recompensa en ${hours}h ${minutes}m.`);
            return;
        }

        const rewardXp = 25;
        const rewardGold = 15;
        addXp(rewardXp);
        addGold(rewardGold);
        setPlayerStats(prevStats => {
            const updatedStats = { ...prevStats, lastDailyRewardClaim: now };
            updatePlayerStats(updatedStats);
            return updatedStats;
        });
        showMessage(`¡Recompensa diaria reclamada! +${rewardXp} XP, +${rewardGold} Oro.`);
        goldSynth.triggerAttackRelease("D4", "8n"); // Play sound
    };

    // Function to calculate time until next daily reward
    const getTimeUntilNextDailyReward = () => {
        const lastClaim = playerStats.lastDailyRewardClaim;
        if (!lastClaim) return null;

        const twentyFourHours = 24 * 60 * 60 * 1000;
        const now = new Date().getTime();
        const timeLeft = twentyFourHours - (now - lastClaim);

        if (timeLeft <= 0) return null; // Can claim now

        const hours = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours}h ${minutes}m`;
    };

    const nextRewardTime = getTimeUntilNextDailyReward();

    // Function to apply a minor punishment (generic)
    const handleApplyMinorPunishment = () => {
        const punishmentVitality = 10;
        const punishmentXp = 5;
        const punishmentGold = 5;

        deductVitality(punishmentVitality);
        deductXp(punishmentXp);
        deductGold(punishmentGold);
        showMessage(`¡Castigo aplicado! -${punishmentVitality} Vitalidad, -${punishmentXp} XP, -${punishmentGold} Oro.`);
        punishmentSynth.triggerAttackRelease("8n"); // Play sound
    };

    // New: Function to apply a specific punishment (e.g., extra task)
    const handleApplyExtraTaskPunishment = async () => {
        if (!currentObjective) {
            showMessage("No hay un objetivo actual para añadir una tarea extra.");
            return;
        }
        const taskText = "Tarea Extra: Reflexionar sobre la procrastinación por 10 minutos.";
        const xpPenalty = 0; // No XP reward for this "punishment task"
        const goldPenalty = 0; // No Gold reward
        const progressContribution = 0; // Doesn't contribute to objective progress

        try {
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/objectives/${currentObjective.id}/subtasks`), {
                text: taskText,
                isCompleted: false,
                xpReward: xpPenalty,
                progressContribution: progressContribution,
                goldReward: goldPenalty,
                dueDate: null,
                isPunishment: true, // Mark as a punishment task
                createdAt: new Date(),
            });
            showMessage("¡Castigo: Tarea extra añadida a tu misión actual!");
            punishmentSynth.triggerAttackRelease("8n"); // Play sound
        } catch (e) {
            console.error("Error adding extra task punishment:", e);
            showMessage("Error al añadir la tarea extra como castigo.");
        }
    };

    // New: Function to apply a gold fine punishment
    const handleApplyGoldFinePunishment = () => {
        const fineAmount = 20;
        deductGold(fineAmount);
        showMessage(`¡Castigo: Multa de ${fineAmount} Oro aplicada por descuido!`);
        punishmentSynth.triggerAttackRelease("8n"); // Play sound
    };


    // Function to buy a reward
    const handleBuyReward = (cost, effectFn, message) => {
        if (playerStats.gold >= cost) {
            deductGold(cost);
            effectFn(); // Apply the reward's effect (e.g., add Vitality, show message)
            showMessage(message);
            goldSynth.triggerAttackRelease("E4", "8n"); // Play sound for purchase
        } else {
            showMessage(`¡No tienes suficiente Oro! Necesitas ${cost} Oro.`);
        }
    };

    // Pomodoro Timer Functions
    const startPomodoro = () => {
        if (isPomodoroRunning) return;
        setIsPomodoroRunning(true);
        showMessage("¡Pomodoro iniciado! Concéntrate.");
        pomodoroBell.triggerAttackRelease("C5", "4n"); // Play bell sound at start
        const interval = setInterval(() => {
            setPomodoroTime(prevTime => {
                if (prevTime <= 1) {
                    clearInterval(interval);
                    setIsPomodoroRunning(false);
                    setPomodoroTime(25 * 60); // Reset for next session
                    addXp(15); // Pomodoro completion reward
                    addGold(10);
                    showMessage("¡Pomodoro completado! Has ganado 15 XP y 10 Oro.");
                    pomodoroBell.triggerAttackRelease("G5", "4n"); // Play bell sound at end
                    checkAchievements('pomodoroCompleted');
                    return 0;
                }
                return prevTime - 1;
            });
        }, 1000);
        setPomodoroInterval(interval);
    };

    const stopPomodoro = () => {
        clearInterval(pomodoroInterval);
        setIsPomodoroRunning(false);
        setPomodoroTime(25 * 60); // Reset
        showMessage("Pomodoro detenido.");
    };

    const formatTime = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    // Daily Streak Logic
    const checkDailyStreak = useCallback(() => {
        const today = new Date().toISOString().split('T')[0];
        const lastStreak = playerStats.lastStreakDate;

        if (lastStreak === today) {
            // Already updated today
            return;
        }

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayString = yesterday.toISOString().split('T')[0];

        if (lastStreak === yesterdayString) {
            // Continued streak
            setPlayerStats(prevStats => {
                const newStreak = prevStats.currentStreak + 1;
                const updatedStats = { ...prevStats, currentStreak: newStreak, lastStreakDate: today };
                updatePlayerStats(updatedStats);
                showMessage(`¡Racha de ${newStreak} días!`);
                checkAchievements('streak', newStreak);
                return updatedStats;
            });
        } else {
            // New streak or broken streak
            setPlayerStats(prevStats => {
                const newStreak = 1; // Start new streak
                const updatedStats = { ...prevStats, currentStreak: newStreak, lastStreakDate: today };
                updatePlayerStats(updatedStats);
                if (prevStats.currentStreak > 0 && lastStreak !== today) { // Only show broken if there was a streak
                    showMessage(`¡Racha rota! Nueva racha de ${newStreak} día.`);
                } else {
                    showMessage(`¡Racha de ${newStreak} día!`);
                }
                checkAchievements('streak', newStreak);
                return updatedStats;
            });
        }
    }, [playerStats.lastStreakDate, playerStats.currentStreak, updatePlayerStats]);

    // Call checkDailyStreak on app load
    useEffect(() => {
        if (db && userId) {
            checkDailyStreak();
        }
    }, [db, userId, checkDailyStreak]);


    // Achievement System
    const allAchievements = [
        { id: 'firstObjective', name: 'Primer Héroe', description: 'Completa tu primer objetivo épico.', type: 'objectiveCompleted', count: 1 },
        { id: 'fiveObjectives', name: 'Conquistador de Metas', description: 'Completa 5 objetivos épicos.', type: 'objectiveCompleted', count: 5 },
        { id: 'level5', name: 'Aventurero Veterano', description: 'Alcanza el Nivel 5.', type: 'levelUp', count: 5 },
        { id: 'level10', name: 'Maestro de la Vida', description: 'Alcanza el Nivel 10.', type: 'levelUp', count: 10 },
        { id: 'firstStreak', name: 'Constancia Inicial', description: 'Alcanza una racha de 3 días.', type: 'streak', count: 3 },
        { id: 'sevenDayStreak', name: 'Hábito Imparable', description: 'Alcanza una racha de 7 días.', type: 'streak', count: 7 },
        { id: 'pomodoroInitiate', name: 'Iniciado Pomodoro', description: 'Completa 1 sesión Pomodoro.', type: 'pomodoroCompleted', count: 1 },
        { id: 'pomodoroMaster', name: 'Maestro Pomodoro', description: 'Completa 10 sesiones Pomodoro.', type: 'pomodoroCompleted', count: 10 },
        { id: 'firstDailyDesire', name: 'Cumplidor de Deseos', description: 'Completa tu primer deseo diario.', type: 'dailyDesireCompleted', count: 1 },
        { id: 'tenDailyDesires', name: 'Deseos Concedidos', description: 'Completa 10 deseos diarios.', type: 'dailyDesireCompleted', count: 10 },
        // Add more achievements here
    ];

    const checkAchievements = useCallback((type, value = null) => {
        setPlayerStats(prevStats => {
            let updatedAchievements = [...prevStats.achievements];
            let statsToUpdate = { ...prevStats }; // Create a mutable copy

            // Update counts for achievements that rely on them
            if (type === 'pomodoroCompleted') {
                statsToUpdate.pomodoroCount = (statsToUpdate.pomodoroCount || 0) + 1;
            }
            if (type === 'dailyDesireCompleted') {
                statsToUpdate.dailyDesireCount = (statsToUpdate.dailyDesireCount || 0) + 1;
            }

            allAchievements.forEach(achievement => {
                if (!updatedAchievements.includes(achievement.id)) {
                    let isUnlocked = false;
                    switch (achievement.type) {
                        case 'objectiveCompleted':
                            const completedObjectivesCount = objectives.filter(o => o.isCompleted).length;
                            if (completedObjectivesCount >= achievement.count) {
                                isUnlocked = true;
                            }
                            break;
                        case 'levelUp':
                            if (value >= achievement.count) { // 'value' is the new level
                                isUnlocked = true;
                            }
                            break;
                        case 'streak':
                            if (value >= achievement.count) // 'value' is the new streak
                                isUnlocked = true;
                            break;
                        case 'pomodoroCompleted':
                            if (statsToUpdate.pomodoroCount >= achievement.count) {
                                isUnlocked = true;
                            }
                            break;
                        case 'dailyDesireCompleted':
                            if (statsToUpdate.dailyDesireCount >= achievement.count) {
                                isUnlocked = true;
                            }
                            break;
                        default:
                            break;
                    }

                    if (isUnlocked) {
                        updatedAchievements.push(achievement.id);
                        showMessage(`¡Logro desbloqueado: "${achievement.name}"!`);
                    }
                }
            });
            return { ...statsToUpdate, achievements: updatedAchievements };
        });
    }, [objectives]); // Depend on objectives to get updated completed count


    // Component for individual Objective Card
    const ObjectiveCard = ({ objective, onSelect, onEdit, onDelete, onComplete }) => {
        const difficultyColors = {
            Fácil: 'bg-green-500',
            Normal: 'bg-yellow-500',
            Difícil: 'bg-red-500',
            Épico: 'bg-purple-500',
        };

        const progress = objective.totalProgress > 0 ? (objective.currentProgress / objective.totalProgress) * 100 : 0;

        // Date formatting for due date
        const dueDate = objective.dueDate ? new Date(objective.dueDate) : null;
        const isOverdue = dueDate && dueDate < new Date();
        const isApproachingDue = dueDate && !isOverdue && (dueDate.getTime() - new Date().getTime() < (7 * 24 * 60 * 60 * 1000)); // Within 7 days

        return (
            <div
                className={`
                    bg-gray-800 bg-opacity-70 rounded-xl p-6 mb-4 shadow-lg
                    flex flex-col md:flex-row items-center justify-between
                    transform transition-transform duration-200 hover:scale-105
                    border-2 ${objective.isCurrent ? 'border-yellow-400' : 'border-transparent'}
                    ${objective.isCompleted ? 'opacity-60 grayscale' : ''}
                    ${isOverdue ? 'border-red-500' : ''}
                    ${isApproachingDue && !isOverdue ? 'border-orange-400' : ''}
                `}
                style={{ borderColor: objective.color || (objective.isCurrent ? '#FACC15' : 'transparent') }}
            >
                <div className="flex items-center mb-4 md:mb-0 md:mr-6">
                    <span className="text-4xl mr-4">{objective.icon || '✨'}</span>
                    <div>
                        <h3 className="text-2xl font-bold text-white mb-1">{objective.name}</h3>
                        <p className="text-gray-300 text-sm">{objective.description}</p>
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${difficultyColors[objective.difficulty] || 'bg-gray-500'} mt-2 inline-block`}>
                            {objective.difficulty}
                        </span>
                        {objective.isCompleted && (
                            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-green-700 text-white ml-2">
                                ¡Completado!
                            </span>
                        )}
                        {dueDate && (
                            <p className={`text-xs mt-2 ${isOverdue ? 'text-red-400 font-bold' : (isApproachingDue ? 'text-orange-300' : 'text-gray-400')}`}>
                                Fecha Límite: {dueDate.toLocaleDateString()} {isOverdue && '(¡Vencido!)'}
                            </p>
                        )}
                    </div>
                </div>
                <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-3 w-full md:w-auto">
                    {objective.isCurrent ? (
                        <button
                            className="bg-green-600 text-white font-bold py-2 px-4 rounded-lg cursor-not-allowed opacity-75 shadow-md"
                            disabled
                        >
                            ✅ Objetivo Actual
                        </button>
                    ) : (
                        <button
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors duration-200"
                            onClick={() => onSelect(objective.id)}
                            disabled={objectives.some(obj => obj.isCurrent) || objective.isCompleted} // Disable if any other objective is current or if this one is completed
                        >
                            Seleccionar
                        </button>
                    )}
                    {!objective.isCompleted && (
                        <button
                            className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors duration-200"
                            onClick={() => onEdit(objective)}
                        >
                            Editar
                        </button>
                    )}
                    {/* The "Completar Misión" button is now only shown in the current objective details section */}
                    <button
                        className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors duration-200"
                        onClick={() => onDelete(objective.id)}
                    >
                        Eliminar
                    </button>
                </div>
            </div>
        );
    };

    // Component for individual Subtask Card
    const SubtaskCard = ({ subtask, onToggleComplete, onDelete, onStartPomodoro, isPomodoroRunning }) => {
        const dueDate = subtask.dueDate ? new Date(subtask.dueDate) : null;
        const isOverdue = dueDate && dueDate < new Date();
        const isApproachingDue = dueDate && !isOverdue && (dueDate.getTime() - new Date().getTime() < (3 * 24 * 60 * 60 * 1000)); // Within 3 days

        return (
            <div className={`
                bg-gray-700 rounded-lg p-4 mb-2 flex items-center justify-between
                shadow-md transition-all duration-200 ease-in-out
                ${subtask.isCompleted ? 'opacity-60 line-through bg-gray-600' : 'hover:bg-gray-600'}
                ${isOverdue && !subtask.isCompleted ? 'border-l-4 border-red-500' : ''}
                ${isApproachingDue && !isOverdue && !subtask.isCompleted ? 'border-l-4 border-orange-400' : ''}
            `}>
                <label className="flex items-center cursor-pointer flex-grow">
                    <input
                        type="checkbox"
                        checked={subtask.isCompleted}
                        onChange={() => onToggleComplete(subtask.id, subtask.isCompleted)}
                        className="form-checkbox h-5 w-5 text-green-500 rounded border-gray-500 bg-gray-800 mr-3"
                    />
                    <span className="text-lg text-white">{subtask.text}</span>
                </label>
                <div className="flex items-center ml-4">
                    {dueDate && (
                        <span className={`text-xs mr-2 ${isOverdue && !subtask.isCompleted ? 'text-red-400 font-bold' : (isApproachingDue && !subtask.isCompleted ? 'text-orange-300' : 'text-gray-400')}`}>
                            {dueDate.toLocaleDateString()}
                        </span>
                    )}
                    <span className="text-yellow-300 text-sm mr-2" title="Recompensa de Oro">💰{subtask.goldReward}</span>
                    <span className="text-blue-300 text-sm mr-2" title="Recompensa de XP">✨{subtask.xpReward}</span>
                    <button
                        onClick={() => onStartPomodoro()}
                        disabled={isPomodoroRunning || subtask.isCompleted}
                        className="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-1 px-2 rounded-md mr-2 transition-colors duration-200"
                        title="Iniciar Pomodoro"
                    >
                        ⏱️ Pomodoro
                    </button>
                    <button
                        onClick={() => onDelete(subtask.id)}
                        className="text-red-400 hover:text-red-600 transition-colors duration-200"
                        title="Eliminar subtarea"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </div>
        );
    };


    // Component for Objective Creation/Editing Form
    const ObjectiveForm = ({ onSave, onCancel, objectiveToEdit }) => {
        const [name, setName] = useState(objectiveToEdit?.name || '');
        const [description, setDescription] = useState(objectiveToEdit?.description || '');
        const [icon, setIcon] = useState(objectiveToEdit?.icon || '✨');
        const [color, setColor] = useState(objectiveToEdit?.color || '#00ffcc'); // Default color
        const [difficulty, setDifficulty] = useState(objectiveToEdit?.difficulty || 'Normal');
        const [totalProgress, setTotalProgress] = useState(objectiveToEdit?.totalProgress || 100); // New: total progress
        const [dueDate, setDueDate] = useState(objectiveToEdit?.dueDate || ''); // New: due date for objective

        const handleSubmit = (e) => {
            e.preventDefault();
            if (!name.trim()) {
                showMessage("El nombre del objetivo no puede estar vacío.");
                return;
            }
            if (totalProgress <= 0) {
                showMessage("El progreso total debe ser mayor que 0.");
                return;
            }
            onSave({ name, description, icon, color, difficulty, totalProgress, dueDate });
        };

        return (
            <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
                <div className="bg-gray-900 rounded-xl p-8 shadow-2xl w-full max-w-lg border-2 border-purple-500">
                    <h2 className="text-3xl font-bold text-white mb-6 text-center">
                        {objectiveToEdit ? 'Editar Objetivo Épico' : 'Crear Nuevo Objetivo Épico'}
                    </h2>
                    <form onSubmit={handleSubmit}>
                        <div className="mb-4">
                            <label htmlFor="name" className="block text-gray-300 text-sm font-bold mb-2">
                                Nombre del Objetivo:
                            </label>
                            <input
                                type="text"
                                id="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="shadow appearance-none border border-gray-700 rounded-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:shadow-outline bg-gray-800"
                                placeholder="Ej: Conquistar la Galaxia"
                                required
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="description" className="block text-gray-300 text-sm font-bold mb-2">
                                Descripción:
                            </label>
                            <textarea
                                id="description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="shadow appearance-none border border-gray-700 rounded-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:shadow-outline bg-gray-800 h-24 resize-none"
                                placeholder="Una breve descripción de tu épica misión..."
                            ></textarea>
                        </div>
                        <div className="mb-4 flex space-x-4">
                            <div className="w-1/2">
                                <label htmlFor="icon" className="block text-gray-300 text-sm font-bold mb-2">
                                    Icono:
                                </label>
                                <input
                                    type="text"
                                    id="icon"
                                    value={icon}
                                    onChange={(e) => setIcon(e.target.value)}
                                    className="shadow appearance-none border border-gray-700 rounded-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:shadow-outline bg-gray-800"
                                    placeholder="✨"
                                />
                                <p className="text-xs text-gray-400 mt-1">Usa emojis o caracteres especiales.</p>
                            </div>
                            <div className="w-1/2">
                                <label htmlFor="color" className="block text-gray-300 text-sm font-bold mb-2">
                                    Color:
                                </label>
                                <input
                                    type="color"
                                    id="color"
                                    value={color}
                                    onChange={(e) => setColor(e.target.value)}
                                    className="shadow appearance-none border border-gray-700 rounded-lg w-full h-10 cursor-pointer focus:outline-none focus:shadow-outline bg-gray-800"
                                />
                            </div>
                        </div>
                        <div className="mb-4">
                            <label htmlFor="difficulty" className="block text-gray-300 text-sm font-bold mb-2">
                                Dificultad:
                            </label>
                            <select
                                id="difficulty"
                                value={difficulty}
                                onChange={(e) => setDifficulty(e.target.value)}
                                className="shadow appearance-none border border-gray-700 rounded-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:shadow-outline bg-gray-800"
                            >
                                <option value="Fácil">Fácil</option>
                                <option value="Normal">Normal</option>
                                <option value="Difícil">Difícil</option>
                                <option value="Épico">Épico</option>
                            </select>
                        </div>
                        <div className="mb-4">
                            <label htmlFor="totalProgress" className="block text-gray-300 text-sm font-bold mb-2">
                                Progreso Total Necesario:
                            </label>
                            <input
                                type="number"
                                id="totalProgress"
                                value={totalProgress}
                                onChange={(e) => setTotalProgress(parseInt(e.target.value) || 0)}
                                className="shadow appearance-none border border-gray-700 rounded-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:shadow-outline bg-gray-800"
                                placeholder="Ej: 100"
                                min="1"
                                required
                            />
                            <p className="text-xs text-gray-400 mt-1">Define cuántos "puntos de progreso" se necesitan para completar este objetivo.</p>
                        </div>
                        <div className="mb-6">
                            <label htmlFor="dueDate" className="block text-gray-300 text-sm font-bold mb-2">
                                Fecha Límite (Opcional):
                            </label>
                            <input
                                type="date"
                                id="dueDate"
                                value={dueDate}
                                onChange={(e) => setDueDate(e.target.value)}
                                className="shadow appearance-none border border-gray-700 rounded-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:shadow-outline bg-gray-800"
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <button
                                type="submit"
                                className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition-transform duration-200 hover:scale-105"
                            >
                                {objectiveToEdit ? 'Guardar Cambios' : 'Crear Objetivo'}
                            </button>
                            <button
                                type="button"
                                onClick={onCancel}
                                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-colors duration-200"
                            >
                                Cancelar
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        );
    };

    // New Component: Onboarding Screen
    const OnboardingScreen = ({ onStartQuest }) => {
        const [objectiveName, setObjectiveName] = useState('');
        const [objectiveDescription, setObjectiveDescription] = useState('');
        const [isStarting, setIsStarting] = useState(false);
        const [selectedPredefined, setSelectedPredefined] = useState('');

        const predefinedObjectives = [
            {
                name: "Establecer Fondo de Emergencia",
                description: "Ahorrar para tener seguridad financiera ante imprevistos.",
                icon: "💰",
                prompt: `Genera subtareas para "Establecer un Fondo de Emergencia". Incluye pasos como calcular gastos, definir un monto objetivo, automatizar ahorros y reducir gastos innecesarios.`
            },
            {
                name: "Mantener Rutina de Ejercicio",
                description: "Incorporar actividad física regular para mejorar la salud y energía.",
                icon: "💪",
                prompt: `Genera subtareas para "Mantener Rutina de Ejercicio". Incluye pasos como definir tipo de ejercicio, frecuencia, horario, seguimiento de progreso y cómo mantener la motivación.`
            },
            {
                name: "Cultivar Bienestar Emocional",
                description: "Desarrollar hábitos para manejar el estrés y mejorar el estado de ánimo.",
                icon: "🧘‍♀️",
                prompt: `Genera subtareas para "Cultivar Bienestar Emocional". Incluye pasos como practicar mindfulness, identificar fuentes de estrés, establecer límites saludables y buscar apoyo social.`
            },
            {
                name: "Aprender Nueva Habilidad Clave",
                description: "Adquirir una habilidad valiosa para el crecimiento personal o profesional.",
                icon: "🧠",
                prompt: `Genera subtareas para "Aprender Nueva Habilidad Clave". Incluye pasos como investigar recursos, establecer un horario de estudio, practicar regularmente y aplicar lo aprendido.`
            },
        ];

        const handleStart = async () => {
            setIsStarting(true);
            let objData = {};
            let subtaskPrompt = null;

            if (selectedPredefined) {
                const predef = predefinedObjectives.find(o => o.name === selectedPredefined);
                if (predef) {
                    objData = {
                        name: predef.name,
                        description: predef.description,
                        icon: predef.icon,
                        difficulty: 'Normal', // Default difficulty for predefined
                        totalProgress: 100, // Default progress
                        dueDate: null,
                        color: '#00ccff', // Default color for predefined
                    };
                    subtaskPrompt = predef.prompt;
                }
            } else if (objectiveName.trim()) {
                objData = {
                    name: objectiveName,
                    description: objectiveDescription,
                    icon: '🌟', // Default icon for custom
                    color: '#00ffcc', // Default color for custom
                    difficulty: 'Normal',
                    totalProgress: 100,
                    dueDate: null,
                };
            } else {
                showMessage("Por favor, selecciona o crea tu primera misión épica.");
                setIsStarting(false);
                return;
            }

            await onStartQuest(objData, subtaskPrompt);
            setIsStarting(false);
        };

        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-black text-white p-6">
                <div className="bg-gray-800 bg-opacity-90 rounded-xl p-8 shadow-2xl w-full max-w-2xl border-2 border-purple-500">
                    <h2 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 mb-6 text-center">
                        ¡Bienvenido a LifeQuest!
                    </h2>
                    <p className="text-lg text-gray-300 mb-8 text-center">
                        Tu aventura para conquistar tus objetivos de vida comienza aquí.
                        Define tu primera gran misión épica para empezar a jugar.
                    </p>

                    <div className="mb-6">
                        <h3 className="text-2xl font-bold text-blue-300 mb-4 text-center">
                            🚀 Misiones de Estabilidad: Empieza con una base sólida
                        </h3>
                        <p className="text-gray-400 text-center mb-4">
                            Estas misiones te ayudarán a construir hábitos esenciales para una vida plena y equilibrada.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                            {predefinedObjectives.map((obj, index) => (
                                <button
                                    key={index}
                                    onClick={() => { setSelectedPredefined(obj.name); setObjectiveName(''); setObjectiveDescription(''); }}
                                    className={`
                                        p-4 rounded-lg border-2 text-left transition-all duration-200
                                        ${selectedPredefined === obj.name
                                            ? 'bg-blue-600 border-blue-400 shadow-lg scale-105'
                                            : 'bg-gray-700 border-gray-600 hover:bg-gray-600'
                                        }
                                    `}
                                >
                                    <span className="text-3xl mr-2">{obj.icon}</span>
                                    <span className="font-semibold text-lg">{obj.name}</span>
                                    <p className="text-sm text-gray-300 mt-1">{obj.description}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="mb-6 text-center">
                        <div className="relative flex py-5 items-center">
                            <div className="flex-grow border-t border-gray-600"></div>
                            <span className="flex-shrink mx-4 text-gray-400 text-lg">O</span>
                            <div className="flex-grow border-t border-gray-600"></div>
                        </div>
                        <h3 className="text-2xl font-bold text-green-300 mb-4 text-center">
                            ✨ Crea tu Propia Misión Épica Personalizada
                        </h3>
                        <p className="text-gray-400 text-center mb-4">
                            Si ya tienes algo grande en mente, ¡adelante!
                        </p>
                        <label htmlFor="firstObjectiveName" className="block text-gray-300 text-sm font-bold mb-2 text-left">
                            Nombre de tu Misión:
                        </label>
                        <input
                            type="text"
                            id="firstObjectiveName"
                            value={objectiveName}
                            onChange={(e) => { setObjectiveName(e.target.value); setSelectedPredefined(''); }}
                            className="shadow appearance-none border border-gray-700 rounded-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:shadow-outline bg-gray-700"
                            placeholder="Ej: Convertirme en un Maestro Chef"
                        />
                    </div>
                    <div className="mb-8">
                        <label htmlFor="firstObjectiveDescription" className="block text-gray-300 text-sm font-bold mb-2 text-left">
                            Descripción de la Misión (Opcional):
                        </label>
                        <textarea
                            id="firstObjectiveDescription"
                            value={objectiveDescription}
                            onChange={(e) => setDescription(e.target.value)}
                            className="shadow appearance-none border border-gray-700 rounded-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:shadow-outline bg-gray-700 h-24 resize-none"
                            placeholder="Una breve descripción de lo que implica esta aventura..."
                        ></textarea>
                    </div>

                    <button
                        onClick={handleStart}
                        disabled={isStarting || (!selectedPredefined && !objectiveName.trim())}
                        className="bg-gradient-to-r from-green-500 to-teal-500 hover:from-green-600 hover:to-teal-600 text-white font-bold py-4 px-8 rounded-xl shadow-lg transform transition-transform duration-200 hover:scale-105 flex items-center justify-center mx-auto space-x-3 text-xl"
                    >
                        {isStarting ? (
                            <>
                                <span className="animate-spin inline-block">⏳</span>
                                <span>Iniciando Aventura...</span>
                            </>
                        ) : (
                            <>
                                <span className="text-2xl">🚀</span>
                                <span>Comenzar mi LifeQuest</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        );
    };

    // New function to handle starting the quest from onboarding
    const handleStartQuest = async (objectiveData, subtaskPrompt = null) => {
        const newObjectiveId = await handleSaveObjective(objectiveData);
        if (newObjectiveId) {
            // After saving, set it as current and generate subtasks
            await handleSelectObjective(newObjectiveId);
            // Give a small delay to ensure currentObjective state is updated before generating subtasks
            setTimeout(() => generateSubtasks(newObjectiveId, subtaskPrompt), 500); // Pass the ID and optional prompt
        }
    };

    // New Component: Tutorial Screen
    const TutorialScreen = ({ onCompleteTutorial, onSkipTutorial }) => {
        const [currentStep, setCurrentStep] = useState(0);

        const tutorialSteps = [
            {
                title: "¡Bienvenido a LifeQuest!",
                description: "Convierte tus objetivos de vida en un emocionante RPG. ¡Prepárate para subir de nivel y conquistar tus metas!",
                icon: "🎮"
            },
            {
                title: "Misiones Épicas y Subtareas",
                description: "Tus grandes objetivos son 'Misiones Épicas'. Divídelas en 'Subtareas' más pequeñas para avanzar. Marca las subtareas como completadas para progresar.",
                icon: "🎯"
            },
            {
                title: "Tu Perfil de Aventurero",
                description: "Aquí verás tu Nivel, XP, Oro y Vitalidad. ¡Sube de nivel, recolecta oro y mantén tu vitalidad alta para ser un héroe imparable!",
                icon: "👤"
            },
            {
                title: "Vitalidad y Satisfacción",
                description: "La 'Vitalidad' es tu energía. Los castigos la reducen, las recompensas la aumentan. Usa el medidor de 'Satisfacción' para registrar cómo te sientes y ver tu evolución.",
                icon: "❤️😊"
            },
            {
                title: "La IA como tu Aliada",
                description: "Gemini te ayuda a generar subtareas, te da consejos motivacionales y te asiste con obstáculos o preguntas de la vida real. ¡No dudes en consultarle!",
                icon: "💡"
            },
            {
                title: "Deseos Diarios y Pomodoro",
                description: "Completa 'Deseos Diarios' para mini-recompensas. Usa el 'Temporizador Pomodoro' en tus subtareas para concentrarte y ganar bonificaciones extra.",
                icon: "🌟⏱️"
            },
            {
                title: "Recompensas y Logros",
                description: "Gana Oro y canjéalo en la 'Tienda de Recompensas' por beneficios en tu vida real. Desbloquea 'Logros' especiales al alcanzar hitos importantes.",
                icon: "🎁🏆"
            },
            {
                title: "¡Que Comience la Aventura!",
                description: "Estás listo para empezar tu LifeQuest. ¡Recuerda, cada pequeño paso te acerca a tu destino épico!",
                icon: "🚀"
            }
        ];

        const handleNext = () => {
            if (currentStep < tutorialSteps.length - 1) {
                setCurrentStep(currentStep + 1);
            } else {
                onCompleteTutorial();
            }
        };

        const handlePrevious = () => {
            if (currentStep > 0) {
                setCurrentStep(currentStep - 1);
            }
        };

        return (
            <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4">
                <div className="bg-gray-900 rounded-xl p-8 shadow-2xl w-full max-w-2xl border-2 border-blue-500 text-center relative">
                    <button
                        onClick={onSkipTutorial}
                        className="absolute top-4 right-4 text-gray-400 hover:text-white text-sm font-semibold"
                    >
                        Saltar Tutorial
                    </button>
                    <div className="text-6xl mb-6 animate-bounce-in-slow">
                        {tutorialSteps[currentStep].icon}
                    </div>
                    <h2 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-600 mb-4">
                        {tutorialSteps[currentStep].title}
                    </h2>
                    <p className="text-lg text-gray-300 mb-8">
                        {tutorialSteps[currentStep].description}
                    </p>
                    <div className="flex justify-between items-center mt-8">
                        <button
                            onClick={handlePrevious}
                            disabled={currentStep === 0}
                            className={`bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors duration-200 ${currentStep === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            Anterior
                        </button>
                        <span className="text-gray-400">
                            Paso {currentStep + 1} de {tutorialSteps.length}
                        </span>
                        <button
                            onClick={handleNext}
                            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow-lg transform transition-transform duration-200 hover:scale-105"
                        >
                            {currentStep === tutorialSteps.length - 1 ? 'Finalizar Tutorial' : 'Siguiente'}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // Function to mark tutorial as completed
    const completeTutorial = () => {
        setPlayerStats(prevStats => {
            const updatedStats = { ...prevStats, hasCompletedTutorial: true };
            updatePlayerStats(updatedStats);
            return updatedStats;
        });
        setShowTutorial(false);
        showMessage("¡Tutorial completado! ¡Que comience tu aventura!");
    };

    // Function to skip tutorial
    const skipTutorial = () => {
        setPlayerStats(prevStats => {
            const updatedStats = { ...prevStats, hasCompletedTutorial: true };
            updatePlayerStats(updatedStats);
            return updatedStats;
        });
        setShowTutorial(false);
        showMessage("Tutorial saltado. ¡A la aventura!");
    };


    // New: Function to generate and save avatar image
    const generateAndSaveAvatarImage = async () => {
        setIsGeneratingAvatarImage(true);
        setGeneratedAvatarImageUrl(null); // Clear previous image

        const avatarPrompts = {
            1: "a simple adventurer walking, pixel art, fantasy RPG style, vibrant colors, forest background, epic pose",
            5: "a knight in shining armor, epic pose, fantasy RPG style, vibrant colors, castle background, detailed, heroic",
            10: "a powerful wizard casting a spell, epic pose, fantasy RPG style, vibrant colors, magical forest background, glowing effects, detailed, heroic",
            15: "a majestic dragon rider, epic pose, fantasy RPG style, vibrant colors, mountain range background, flying, detailed, heroic",
            20: "a king or queen on a throne, epic pose, fantasy RPG style, vibrant colors, grand hall background, regal, detailed, heroic",
        };

        // Get the most appropriate prompt based on level
        let prompt = avatarPrompts[1]; // Default
        if (playerStats.level >= 20) prompt = avatarPrompts[20];
        else if (playerStats.level >= 15) prompt = avatarPrompts[15];
        else if (playerStats.level >= 10) prompt = avatarPrompts[10];
        else if (playerStats.level >= 5) prompt = avatarPrompts[5];

        const motivationalPhrases = [
            "¡Tu aventura continúa!",
            "¡Cada paso cuenta!",
            "¡Eres imparable!",
            "¡Conquista tus metas!",
            "¡El éxito te espera!",
            "¡Sigue subiendo de nivel!",
            "¡Forjando tu leyenda!",
            "¡La perseverancia es clave!",
            "¡Cree en tu poder!",
            "¡El mundo es tu misión!"
        ];
        const randomMotivationalPhrase = motivationalPhrases[Math.floor(Math.random() * motivationalPhrases.length)];

        try {
            const payload = { instances: { prompt: prompt }, parameters: { "sampleCount": 1 } };
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
                const imageUrl = `data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`;

                // Use a temporary image to draw on canvas
                const img = new Image();
                img.src = imageUrl;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 512; // Standard size for generated images
                    canvas.height = 512;
                    const ctx = canvas.getContext('2d');

                    // Draw the generated image
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                    // Add text overlay
                    ctx.font = 'bold 32px Inter';
                    ctx.fillStyle = '#FFFFFF';
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 4;
                    ctx.textAlign = 'center';

                    // Draw XP, Gold, Level
                    ctx.strokeText(`Nivel: ${playerStats.level} | XP: ${playerStats.xp} | Oro: ${playerStats.gold}`, canvas.width / 2, 50);
                    ctx.fillText(`Nivel: ${playerStats.level} | XP: ${playerStats.xp} | Oro: ${playerStats.gold}`, canvas.width / 2, 50);

                    // Draw motivational phrase
                    ctx.font = 'bold 24px Inter';
                    ctx.strokeText(randomMotivationalPhrase, canvas.width / 2, canvas.height - 30);
                    ctx.fillText(randomMotivationalPhrase, canvas.width / 2, canvas.height - 30);

                    const finalImageUrl = canvas.toDataURL('image/png');
                    setGeneratedAvatarImageUrl(finalImageUrl);

                    // Trigger download
                    const link = document.createElement('a');
                    link.href = finalImageUrl;
                    link.download = `LifeQuest_Hero_${playerStats.level}.png`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);

                    showMessage("¡Imagen de héroe generada y guardada!");
                };
                img.onerror = () => {
                    showMessage("Error al cargar la imagen generada.");
                    setGeneratedAvatarImageUrl(null);
                };

            } else {
                showMessage("No se pudo generar la imagen del avatar. Intenta de nuevo.");
                console.error("Unexpected API response structure for image generation:", result);
            }
        } catch (error) {
            console.error("Error generating avatar image:", error);
            showMessage("Error al generar la imagen del avatar.");
        } finally {
            setIsGeneratingAvatarImage(false);
        }
    };

    // New: Function to generate and save achievement image
    const generateAndSaveAchievementImage = async (achievement) => {
        if (!achievement) return;

        setIsGeneratingAchievementImage(true);
        setGeneratedAchievementImageUrl(null); // Clear previous image

        const prompt = `A vibrant, golden, and epic background for an achievement unlocked, with glowing effects and a sense of accomplishment. Fantasy RPG style.`;

        try {
            const payload = { instances: { prompt: prompt }, parameters: { "sampleCount": 1 } };
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
                const imageUrl = `data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`;

                const img = new Image();
                img.src = imageUrl;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 512;
                    canvas.height = 512;
                    const ctx = canvas.getContext('2d');

                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                    ctx.font = 'bold 36px Inter';
                    ctx.fillStyle = '#FFFFFF';
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 5;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    // Draw "Logro Desbloqueado!"
                    ctx.strokeText("¡Logro Desbloqueado!", canvas.width / 2, 80);
                    ctx.fillText("¡Logro Desbloqueado!", canvas.width / 2, 80);

                    // Draw Achievement Name
                    ctx.font = 'bold 28px Inter';
                    ctx.strokeText(achievement.name, canvas.width / 2, canvas.height / 2 - 20);
                    ctx.fillText(achievement.name, canvas.width / 2, canvas.height / 2 - 20);

                    // Draw Achievement Description (wrap text if necessary)
                    ctx.font = '20px Inter';
                    ctx.lineWidth = 3;
                    const maxWidth = canvas.width - 100; // Padding
                    const lineHeight = 25;
                    let y = canvas.height / 2 + 20;

                    const words = achievement.description.split(' ');
                    let line = '';
                    for (let n = 0; n < words.length; n++) {
                        let testLine = line + words[n] + ' ';
                        let metrics = ctx.measureText(testLine);
                        let testWidth = metrics.width;
                        if (testWidth > maxWidth && n > 0) {
                            ctx.strokeText(line, canvas.width / 2, y);
                            ctx.fillText(line, canvas.width / 2, y);
                            line = words[n] + ' ';
                            y += lineHeight;
                        } else {
                            line = testLine;
                        }
                    }
                    ctx.strokeText(line, canvas.width / 2, y);
                    ctx.fillText(line, canvas.width / 2, y);


                    const finalImageUrl = canvas.toDataURL('image/png');
                    setGeneratedAchievementImageUrl(finalImageUrl);

                    const link = document.createElement('a');
                    link.href = finalImageUrl;
                    link.download = `LifeQuest_Logro_${achievement.name.replace(/\s/g, '_')}.png`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);

                    showMessage(`¡Imagen de logro "${achievement.name}" generada y guardada!`);
                };
                img.onerror = () => {
                    showMessage("Error al cargar la imagen generada para el logro.");
                    setGeneratedAchievementImageUrl(null);
                };

            } else {
                showMessage("No se pudo generar la imagen del logro. Intenta de nuevo.");
                console.error("Unexpected API response structure for achievement image generation:", result);
            }
        } catch (error) {
            console.error("Error generating achievement image:", error);
            showMessage("Error al generar la imagen del logro.");
        } finally {
            setIsGeneratingAchievementImage(false);
            setSelectedAchievementForImage(null); // Close modal/clear selection
        }
    };


    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-black text-white">
                <div className="text-3xl font-bold animate-pulse">Cargando LifeQuest...</div>
            </div>
        );
    }

    // Render onboarding screen if no objectives exist
    if (showOnboarding) {
        return <OnboardingScreen onStartQuest={handleStartQuest} />;
    }

    // Render tutorial screen if objectives exist but tutorial not completed
    if (showTutorial && !playerStats.hasCompletedTutorial) {
        return <TutorialScreen onCompleteTutorial={completeTutorial} onSkipTutorial={skipTutorial} />;
    }

    // Helper function for logging tab changes
    const handleSetActiveTab = (tabName) => {
        console.log(`Intentando cambiar a la pestaña: ${tabName}`);
        setActiveTab(tabName);
    };

    // Console logs for debugging modals
    {showObjectiveForm && console.log("DEBUG: Modal 'ObjectiveForm' está activo.")}
    {showOnboarding && console.log("DEBUG: Modal 'OnboardingScreen' está activo.")}
    {showTutorial && console.log("DEBUG: Modal 'TutorialScreen' está activo.")}
    {showObjectiveNarrativeModal && console.log("DEBUG: Modal 'ObjectiveNarrativeModal' está activo.")}
    {isGeneratingAchievementImage && console.log("DEBUG: Modal 'Achievement Image Loading' está activo.")}
    {generatedAchievementImageUrl && console.log("DEBUG: Modal 'Achievement Image Preview' está activo.")}


    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-6 pb-20 font-inter"> {/* Added pb-20 for bottom padding */}
            {/* Tailwind CSS CDN */}
            <script src="https://cdn.tailwindcss.com"></script>
            {/* Inter Font */}
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
            {/* Tone.js CDN */}
            <script src="https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.min.js"></script>
            {/* Font Awesome for icons */}
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" />


            {/* Message Display */}
            {message && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-full shadow-xl z-50 animate-bounce-in">
                    {message}
                </div>
            )}

            {/* Objective Completion Narrative Modal */}
            {showObjectiveNarrativeModal && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-900 rounded-xl p-8 shadow-2xl w-full max-w-lg border-2 border-green-500 text-center relative">
                        <h3 className="text-3xl font-bold text-green-300 mb-4">¡Misión Completada!</h3>
                        <p className="text-lg text-gray-300 mb-6 italic">"{objectiveNarrative}"</p>
                        <button
                            onClick={() => setShowObjectiveNarrativeModal(false)}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors duration-200"
                        >
                            Cerrar
                        </button>
                    </div>
                </div>
            )}

            <header className="text-center mb-10">
                <h1 className="text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 mb-4">
                    🎮 LifeQuest: Tu Aventura Épica
                </h1>
                <p className="text-lg text-gray-300">
                    ¡Gestiona tus objetivos de vida como misiones en un RPG!
                </p>
                {userId && (
                    <p className="text-sm text-gray-400 mt-2">
                        ID de Usuario: <span className="font-mono bg-gray-800 px-2 py-1 rounded-md">{userId}</span>
                    </p>
                )}
            </header>

            {/* Desktop Navigation Menu */}
            <nav className="hidden md:flex mb-8 bg-gray-800 bg-opacity-80 rounded-xl p-2 shadow-lg justify-around relative z-20">
                <button
                    onClick={() => handleSetActiveTab('missions')}
                    className={`py-2 px-4 rounded-lg font-bold transition-colors duration-200 ${activeTab === 'missions' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
                >
                    Misiones
                </button>
                <button
                    onClick={() => handleSetActiveTab('profile')}
                    className={`py-2 px-4 rounded-lg font-bold transition-colors duration-200 ${activeTab === 'profile' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
                >
                    Perfil
                </button>
                <button
                    onClick={() => handleSetActiveTab('rewards')}
                    className={`py-2 px-4 rounded-lg font-bold transition-colors duration-200 ${activeTab === 'rewards' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
                >
                    Recompensas
                </button>
                <button
                    onClick={() => handleSetActiveTab('achievements')}
                    className={`py-2 px-4 rounded-lg font-bold transition-colors duration-200 ${activeTab === 'achievements' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
                >
                    Logros
                </button>
            </nav>

            <main className="max-w-4xl mx-auto">
                {console.log(`DEBUG: Contenido de la pestaña activa siendo renderizado: ${activeTab}`)}
                {activeTab === 'profile' && (
                    <section className="mb-10 p-6 bg-gray-800 bg-opacity-70 rounded-xl shadow-lg border-2 border-green-500">
                        <h2 className="text-3xl font-bold text-green-300 mb-4 border-b-2 border-green-500 pb-2 flex items-center">
                            <span className="mr-3">👤</span> Perfil de Aventurero
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-lg">
                            <div className="flex items-center">
                                <span className="text-yellow-400 mr-2">🌟</span> Nivel: <span className="font-bold ml-2">{playerStats.level}</span>
                            </div>
                            <div className="flex items-center">
                                <span className="text-blue-400 mr-2">✨</span> XP: <span className="font-bold ml-2">{playerStats.xp} / {playerStats.xpToNextLevel}</span>
                                <div className="flex-grow bg-gray-700 rounded-full h-3 ml-3">
                                    <div
                                        className="bg-blue-500 h-3 rounded-full transition-all duration-500 ease-out"
                                        style={{ width: `${(playerStats.xp / playerStats.xpToNextLevel) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                            <div className="flex items-center">
                                <span className="text-yellow-500 mr-2">💰</span> Oro: <span className="font-bold ml-2">{playerStats.gold}</span>
                            </div>
                            <div className="flex items-center">
                                <span className="text-red-500 mr-2">❤️</span> Vitalidad: <span className="font-bold ml-2">{playerStats.vitality} / {playerStats.maxVitality}</span>
                                <div className="flex-grow bg-gray-700 rounded-full h-3 ml-3">
                                    <div
                                        className="bg-red-500 h-3 rounded-full transition-all duration-500 ease-out"
                                        style={{ width: `${(playerStats.vitality / playerStats.maxVitality) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                            <div className="flex items-center col-span-full">
                                <span className="text-purple-400 mr-2">😊</span> Satisfacción Actual: <span className="font-bold ml-2">{playerStats.currentSatisfaction}%</span>
                                <div className="flex-grow bg-gray-700 rounded-full h-3 ml-3">
                                    <div
                                        className="bg-purple-500 h-3 rounded-full transition-all duration-500 ease-out"
                                        style={{ width: `${playerStats.currentSatisfaction}%` }}
                                    ></div>
                                </div>
                            </div>
                            <div className="flex items-center col-span-full">
                                <span className="text-orange-400 mr-2">🔥</span> Racha de Actividad: <span className="font-bold ml-2">{playerStats.currentStreak} días</span>
                            </div>
                            <div className="flex items-center col-span-full">
                                <span className="text-cyan-400 mr-2">⏱️</span> Sesiones Pomodoro Completadas: <span className="font-bold ml-2">{playerStats.pomodoroCount || 0}</span>
                            </div>
                            <div className="flex items-center col-span-full">
                                <span className="text-pink-400 mr-2">✨</span> Deseos Diarios Cumplidos: <span className="font-bold ml-2">{playerStats.dailyDesireCount || 0}</span>
                            </div>
                        </div>
                        {/* Avatar Conceptual */}
                        <div className="mt-8 text-center">
                            <h3 className="text-xl font-semibold text-white mb-3">Tu Avatar de Aventurero</h3>
                            <div className="w-32 h-32 bg-gray-700 rounded-full mx-auto flex items-center justify-center text-6xl border-2 border-gray-600 shadow-lg relative overflow-hidden">
                                {/* Dynamic Avatar based on level */}
                                {playerStats.level >= 20 ? '👑' : // King/Queen
                                 playerStats.level >= 15 ? '🐉' : // Dragon rider / Powerful being
                                 playerStats.level >= 10 ? '🧙‍♂️' : // Wizard/Mage
                                 playerStats.level >= 5 ? '🛡️' : // Knight/Warrior
                                 '🚶‍♂️'} {/* Basic adventurer */}
                                <div className="absolute inset-0 bg-gradient-to-br from-transparent to-black opacity-20 rounded-full"></div>
                            </div>
                            <p className="text-gray-400 text-sm mt-2">
                                (Tu avatar evoluciona con tu nivel. ¡Sigue adelante!)
                            </p>
                            <button
                                onClick={generateAndSaveAvatarImage}
                                disabled={isGeneratingAvatarImage}
                                className="bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition-transform duration-200 hover:scale-105 mt-4 flex items-center justify-center mx-auto space-x-2"
                            >
                                {isGeneratingAvatarImage ? (
                                    <>
                                        <span className="animate-spin inline-block">⏳</span>
                                        <span>Generando Avatar...</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-xl">🖼️</span>
                                        <span>Generar y Guardar Imagen de Héroe</span>
                                    </>
                                )}
                            </button>
                            {generatedAvatarImageUrl && (
                                <div className="mt-4">
                                    <h4 className="text-lg font-semibold text-white mb-2">Previsualización del Avatar:</h4>
                                    <img src={generatedAvatarImageUrl} alt="Generated LifeQuest Hero" className="mx-auto rounded-lg shadow-xl border-2 border-gray-700 max-w-full h-auto" />
                                </div>
                            )}
                        </div>

                        <div className="mt-6 text-center">
                            <h3 className="text-xl font-semibold text-white mb-3">Registrar Satisfacción Diaria</h3>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={playerStats.currentSatisfaction}
                                onChange={(e) => updateSatisfaction(parseInt(e.target.value))}
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-lg accent-purple-500"
                            />
                            <p className="text-sm text-gray-400 mt-2">
                                ¿Cómo te sientes hoy? ({playerStats.currentSatisfaction}%)
                            </p>
                            <button
                                onClick={() => updateSatisfaction(playerStats.currentSatisfaction)} // Save current value
                                className="bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition-transform duration-200 hover:scale-105 mt-4"
                            >
                                Guardar Satisfacción
                            </button>
                        </div>

                        {/* Historial de Satisfacción Chart */}
                        <div className="mt-6">
                            <h3 className="text-xl font-semibold text-white mb-3">Historial de Satisfacción (Últimos 7 Días)</h3>
                            <div className="flex items-end h-32 bg-gray-700 rounded-lg p-2 justify-around">
                                {playerStats.satisfactionHistory.slice(-7).map((entry, index) => (
                                    <div
                                        key={index}
                                        className="flex-1 mx-1 rounded-t-md bg-purple-500 transition-all duration-300 ease-out flex flex-col justify-end items-center"
                                        style={{ height: `${entry.value}%` }}
                                        title={`${entry.date}: ${entry.value}%`}
                                    >
                                        <span className="text-xs text-white opacity-80 mb-1">{entry.value}%</span>
                                        <span className="text-xs text-gray-300 rotate-90 origin-bottom-left whitespace-nowrap mb-2">{entry.date.substring(5)}</span> {/* Show MM-DD */}
                                    </div>
                                ))}
                                {playerStats.satisfactionHistory.length === 0 && (
                                    <p className="text-gray-400 text-sm mt-2 absolute inset-0 flex items-center justify-center">Registra tu satisfacción diaria para ver tu progreso aquí.</p>
                                )}
                            </div>
                        </div>


                        <div className="mt-6 text-center">
                            <button
                                onClick={getMotivationalAdvice}
                                disabled={isGettingAdvice}
                                className="bg-gradient-to-r from-pink-500 to-red-500 hover:from-pink-600 hover:to-red-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition-transform duration-200 hover:scale-105 flex items-center justify-center mx-auto space-x-2"
                            >
                                {isGettingAdvice ? (
                                    <>
                                        <span className="animate-spin inline-block">⏳</span>
                                        <span>Obteniendo Consejo...</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-xl">✨</span>
                                        <span>Pedir Consejo Motivacional</span>
                                    </>
                                )}
                            </button>
                            {motivationalAdvice && (
                                <p className="mt-4 p-3 bg-gray-700 rounded-lg italic text-gray-200 border border-gray-600">
                                    "{motivationalAdvice}"
                                </p>
                            )}
                        </div>

                        {/* Daily Affirmation */}
                        <div className="mt-8 pt-6 border-t border-gray-700 text-center">
                            <h3 className="text-xl font-semibold text-white mb-3">Tu Afirmación Diaria</h3>
                            <button
                                onClick={getDailyAffirmation}
                                disabled={isGettingAffirmation}
                                className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition-transform duration-200 hover:scale-105 flex items-center justify-center mx-auto space-x-2"
                            >
                                {isGettingAffirmation ? (
                                    <>
                                        <span className="animate-spin inline-block">⏳</span>
                                        <span>Generando Afirmación...</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-xl">☀️</span>
                                        <span>Generar Afirmación Diaria</span>
                                    </>
                                )}
                            </button>
                            {dailyAffirmation && (
                                <p className="mt-4 p-3 bg-gray-700 rounded-lg italic text-gray-200 border border-gray-600">
                                    "{dailyAffirmation}"
                                </p>
                            )}
                        </div>
                    </section>
                )}

                {activeTab === 'missions' && (
                    <>
                        <div className="flex justify-end mb-6">
                            <button
                                onClick={() => { setShowObjectiveForm(true); setEditingObjective(null); }}
                                className="bg-gradient-to-r from-green-500 to-teal-500 hover:from-green-600 hover:to-teal-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg transform transition-transform duration-200 hover:scale-105 flex items-center space-x-2"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                                <span>Nuevo Objetivo Épico</span>
                            </button>
                        </div>

                        {/* Daily Desire / Mini-Quest Section */}
                        {dailyDesire && !dailyDesire.completed && (
                            <section className="mb-8 p-6 bg-blue-800 bg-opacity-70 rounded-xl shadow-lg border-2 border-blue-400 animate-fade-in">
                                <h2 className="text-2xl font-bold text-blue-200 mb-3 flex items-center">
                                    <span className="mr-2">🌟</span> Deseo Diario
                                </h2>
                                <p className="text-white text-lg mb-4">{dailyDesire.text}</p>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-yellow-300">
                                        Recompensa: 💰{dailyDesire.goldReward} Oro, ✨{dailyDesire.xpReward} XP
                                    </span>
                                    <button
                                        onClick={handleCompleteDailyDesire}
                                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors duration-200"
                                    >
                                        Completar Deseo
                                    </button>
                                </div>
                            </section>
                        )}


                        {/* Current Objective Details Section */}
                        {currentObjective && (
                            <section className="mb-10 p-6 bg-gray-800 bg-opacity-70 rounded-xl shadow-lg border-2 border-yellow-400">
                                <h2 className="text-3xl font-bold text-yellow-300 mb-4 border-b-2 border-yellow-500 pb-2 flex items-center">
                                    <span className="mr-3">🎯</span> Misión Actual: {currentObjective.name}
                                </h2>
                                <p className="text-gray-300 mb-4">{currentObjective.description}</p>
                                <div className="mb-4">
                                    <h3 className="text-xl font-semibold text-white mb-2">Progreso de la Misión:</h3>
                                    <div className="w-full bg-gray-700 rounded-full h-6">
                                        <div
                                            className="bg-gradient-to-r from-blue-500 to-purple-500 h-6 rounded-full text-right pr-2 flex items-center justify-end font-bold transition-all duration-700 ease-out"
                                            style={{ width: `${(currentObjective.currentProgress / currentObjective.totalProgress) * 100}%` }}
                                        >
                                            {Math.round((currentObjective.currentProgress / currentObjective.totalProgress) * 100)}%
                                        </div>
                                    </div>
                                    <p className="text-sm text-gray-400 mt-1">
                                        {currentObjective.currentProgress} / {currentObjective.totalProgress} puntos de progreso
                                    </p>
                                </div>
                                {currentObjective.currentProgress >= currentObjective.totalProgress && !currentObjective.isCompleted && (
                                    <div className="text-center mt-4">
                                        <button
                                            className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-8 rounded-lg shadow-lg transform transition-transform duration-200 hover:scale-105"
                                            onClick={() => handleCompleteObjective(currentObjective.id)}
                                        >
                                            ¡Misión Lista para Completar!
                                        </button>
                                    </div>
                                )}
                                <div className="mt-6">
                                    <h3 className="text-xl font-semibold text-white mb-3 border-b border-gray-700 pb-2 flex items-center justify-between">
                                        Misiones Diarias y Semanales
                                        <button
                                            onClick={() => generateSubtasks()} // Call without ID, will use currentObjective
                                            disabled={isGeneratingSubtasks}
                                            className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition-transform duration-200 hover:scale-105 flex items-center space-x-2"
                                        >
                                            {isGeneratingSubtasks ? (
                                                <>
                                                    <span className="animate-spin inline-block">⏳</span>
                                                    <span>Generando...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="text-xl">✨</span>
                                                    <span>Generar Subtareas</span>
                                                </>
                                            )}
                                        </button>
                                    </h3>
                                    {subtasks.length > 0 ? (
                                        <div className="space-y-2">
                                            {subtasks.map(task => (
                                                <SubtaskCard
                                                    key={task.id}
                                                    subtask={task}
                                                    onToggleComplete={handleToggleSubtaskComplete}
                                                    onDelete={handleDeleteSubtask}
                                                    onStartPomodoro={startPomodoro}
                                                    isPomodoroRunning={isPomodoroRunning}
                                                />
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-gray-400">
                                            No hay subtareas para esta misión. ¡Crea una o genera algunas con la IA!
                                        </p>
                                    )}
                                    <div className="mt-4 flex">
                                        <input
                                            type="text"
                                            value={newSubtaskText}
                                            onChange={(e) => setNewSubtaskText(e.target.value)}
                                            placeholder="Añadir nueva subtarea manualmente..."
                                            className="flex-grow shadow appearance-none border border-gray-700 rounded-l-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:shadow-outline bg-gray-800"
                                        />
                                        <button
                                            onClick={() => handleAddSubtask(newSubtaskText)}
                                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-r-lg shadow-md transition-colors duration-200"
                                        >
                                            Añadir
                                        </button>
                                    </div>
                                    {/* Pomodoro Display */}
                                    <div className="mt-6 p-4 bg-gray-700 rounded-lg shadow-inner flex items-center justify-between">
                                        <span className="text-xl font-bold text-white">
                                            ⏱️ Pomodoro: {formatTime(pomodoroTime)}
                                        </span>
                                        <div className="flex space-x-2">
                                            <button
                                                onClick={startPomodoro}
                                                disabled={isPomodoroRunning}
                                                className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200"
                                            >
                                                Iniciar
                                            </button>
                                            <button
                                                onClick={stopPomodoro}
                                                disabled={!isPomodoroRunning}
                                                className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200"
                                            >
                                                Detener
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* New: Ask Gemini for Obstacle Advice */}
                                <div className="mt-8 pt-6 border-t border-gray-700">
                                    <h3 className="text-xl font-semibold text-white mb-3 flex items-center">
                                        <span className="mr-2">🚧</span> Pedir Ayuda a Gemini para este Obstáculo
                                    </h3>
                                    <textarea
                                        value={obstaclePrompt}
                                        onChange={(e) => setObstaclePrompt(e.target.value)}
                                        placeholder="Ej: Estoy atascado en 'Investigar opciones de inversión', ¿por dónde empiezo?"
                                        className="shadow appearance-none border border-gray-700 rounded-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:shadow-outline bg-gray-800 h-24 resize-none mb-4"
                                    ></textarea>
                                    <button
                                        onClick={getObstacleAdvice}
                                        disabled={isGettingObstacleAdvice || !obstaclePrompt.trim()}
                                        className="bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition-transform duration-200 hover:scale-105 flex items-center justify-center space-x-2 w-full"
                                    >
                                        {isGettingObstacleAdvice ? (
                                            <>
                                                <span className="animate-spin inline-block">⏳</span>
                                                <span>Obteniendo Solución...</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-xl">💡</span>
                                                <span>Pedir Consejo de Obstáculo</span>
                                            </>
                                        )}
                                    </button>
                                    {obstacleAdvice && (
                                        <p className="mt-4 p-3 bg-gray-700 rounded-lg italic text-gray-200 border border-gray-600">
                                            "{obstacleAdvice}"
                                        </p>
                                    )}
                                </div>

                                {/* Ask Gemini for Real-World Advice (kept here for easy access) */}
                                <div className="mt-8 pt-6 border-t border-gray-700">
                                    <h3 className="text-xl font-semibold text-white mb-3 flex items-center">
                                        <span className="mr-2">🌍</span> Preguntar a Gemini sobre la Vida Real
                                    </h3>
                                    <textarea
                                        value={realWorldPrompt}
                                        onChange={(e) => setRealWorldPrompt(e.target.value)}
                                        placeholder="Ej: ¿Cuánto necesito ahorrar para un viaje a Galápagos? o ¿Cuáles son los primeros pasos para invertir en bienes raíces?"
                                        className="shadow appearance-none border border-gray-700 rounded-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:shadow-outline bg-gray-800 h-24 resize-none mb-4"
                                    ></textarea>
                                    <button
                                        onClick={getRealWorldAdvice}
                                        disabled={isGettingRealWorldAdvice || !realWorldPrompt.trim()}
                                        className="bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition-transform duration-200 hover:scale-105 flex items-center justify-center space-x-2 w-full"
                                    >
                                        {isGettingRealWorldAdvice ? (
                                            <>
                                                <span className="animate-spin inline-block">⏳</span>
                                                <span>Consultando a Gemini...</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-xl">✨</span>
                                                <span>Preguntar a Gemini</span>
                                            </>
                                        )}
                                    </button>
                                    {realWorldAdvice && (
                                        <p className="mt-4 p-3 bg-gray-700 rounded-lg italic text-gray-200 border border-gray-600">
                                            "{realWorldAdvice}"
                                        </p>
                                    )}
                                </div>
                            </section>
                        )}


                        <section className="mb-10">
                            <h2 className="text-3xl font-bold text-purple-300 mb-6 border-b-2 border-purple-500 pb-2">
                                Tus Misiones Épicas
                            </h2>
                            {objectives.length === 0 ? (
                                <p className="text-gray-400 text-center text-lg py-8 bg-gray-800 bg-opacity-50 rounded-xl">
                                    Aún no tienes objetivos. ¡Crea tu primera misión épica!
                                </p>
                            ) : (
                                <div className="grid gap-4">
                                    {objectives.map(obj => (
                                        <ObjectiveCard
                                            key={obj.id}
                                            objective={obj}
                                            onSelect={handleSelectObjective}
                                            onEdit={(objToEdit) => { setEditingObjective(objToEdit); setShowObjectiveForm(true); }}
                                            onDelete={handleDeleteObjective}
                                            onComplete={handleCompleteObjective} // Pass new complete handler
                                        />
                                    ))}
                                </div>
                            )}
                        </section>
                    </>
                )}

                {activeTab === 'rewards' && (
                    <section className="p-6 bg-gray-800 bg-opacity-70 rounded-xl shadow-lg border-2 border-yellow-500">
                        <h2 className="text-3xl font-bold text-yellow-300 mb-4 border-b-2 border-yellow-500 pb-2 flex items-center">
                            <span className="mr-3">🎁</span> Recompensas y Consecuencias
                        </h2>
                        <p className="text-gray-300 mb-6">
                            El Oro que ganas con tus subtareas es tu **"ahorro virtual"** para las recompensas que te motivan en la vida real.
                            Úsalo para canjear ese "permiso" para ver tu serie favorita, o el "día libre" que te mereces.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                            {/* Reclamar Recompensa Diaria */}
                            <div className="bg-gray-700 p-4 rounded-lg shadow-md flex flex-col justify-between border border-gray-600">
                                <h3 className="text-xl font-semibold text-green-400 mb-3 flex items-center">
                                    <span className="mr-2">🎉</span> Recompensa Diaria
                                </h3>
                                <p className="text-gray-300 text-sm mb-3">
                                    Reclama tu recompensa una vez cada 24 horas por tu constancia.
                                </p>
                                <button
                                    onClick={handleClaimDailyReward}
                                    disabled={!!nextRewardTime}
                                    className={`
                                        ${!!nextRewardTime ? 'bg-gray-600 cursor-not-allowed' : 'bg-gradient-to-r from-green-500 to-lime-500 hover:from-green-600 hover:to-lime-600'}
                                        text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition-transform duration-200 hover:scale-105 flex items-center space-x-2 w-full justify-center mt-auto
                                    `}
                                >
                                    <span className="text-xl">🌟</span>
                                    <span>Reclamar Recompensa Diaria</span>
                                </button>
                                {nextRewardTime && (
                                    <p className="text-sm text-gray-400 mt-2 text-center">
                                        Próxima recompensa en: {nextRewardTime}
                                    </p>
                                )}
                            </div>

                            {/* Aplicar Consecuencia */}
                            <div className="bg-gray-700 p-4 rounded-lg shadow-md flex flex-col justify-between border border-gray-600">
                                <h3 className="text-xl font-semibold text-red-400 mb-3 flex items-center">
                                    <span className="mr-2">🚨</span> Aplicar Consecuencia
                                </h3>
                                <p className="text-gray-300 text-sm mb-3">
                                    Sé honesto contigo mismo. Aplica un castigo cuando incumplas una tarea importante o procrastines.
                                </p>
                                <div className="flex flex-col space-y-2 mt-auto">
                                    <button
                                        onClick={handleApplyMinorPunishment}
                                        className="bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-transform duration-200 hover:scale-105 flex items-center space-x-2 w-full justify-center"
                                    >
                                        <span className="text-xl">💀</span>
                                        <span>Castigo Menor (-10 Vitalidad, -5 XP, -5 Oro)</span>
                                    </button>
                                    <button
                                        onClick={handleApplyExtraTaskPunishment}
                                        className="bg-gradient-to-r from-red-700 to-red-600 hover:from-red-800 hover:to-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-transform duration-200 hover:scale-105 flex items-center space-x-2 w-full justify-center"
                                    >
                                        <span className="text-xl">📝</span>
                                        <span>Tarea Extra Imprevista</span>
                                    </button>
                                    <button
                                        onClick={handleApplyGoldFinePunishment}
                                        className="bg-gradient-to-r from-orange-700 to-orange-600 hover:from-orange-800 hover:to-orange-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-transform duration-200 hover:scale-105 flex items-center space-x-2 w-full justify-center"
                                    >
                                        <span className="text-xl">💸</span>
                                        <span>Multa de Oro (-20 Oro)</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Personalized Suggestions from Gemini */}
                        <div className="mt-8 pt-6 border-t border-gray-700">
                            <h3 className="text-xl font-semibold text-white mb-3 flex items-center">
                                <span className="mr-2">💡</span> Sugerencias Personalizadas de Gemini
                            </h3>
                            <p className="text-gray-300 text-sm mb-4">
                                ¿Necesitas ideas de recompensas o castigos que se ajusten a tu estilo de vida?
                                ¡Pregúntale a Gemini!
                            </p>
                            <div className="flex space-x-4 mb-4">
                                <button
                                    onClick={() => getPersonalizedSuggestions('rewards')}
                                    disabled={isGettingSuggestions}
                                    className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition-transform duration-200 hover:scale-105 flex items-center justify-center space-x-2 flex-grow"
                                >
                                    {isGettingSuggestions ? (
                                        <>
                                            <span className="animate-spin inline-block">⏳</span>
                                            <span>Obteniendo...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-xl">🎁</span>
                                            <span>Sugerir Recompensas</span>
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={() => getPersonalizedSuggestions('punishments')}
                                    disabled={isGettingSuggestions}
                                    className="bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition-transform duration-200 hover:scale-105 flex items-center justify-center space-x-2 flex-grow"
                                >
                                    {isGettingSuggestions ? (
                                        <>
                                            <span className="animate-spin inline-block">⏳</span>
                                            <span>Obteniendo...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-xl">⛓️</span>
                                            <span>Sugerir Castigos</span>
                                        </>
                                    )}
                                </button>
                            </div>
                            {personalizedSuggestions && (
                                <p className="mt-4 p-3 bg-gray-700 rounded-lg italic text-gray-200 border border-gray-600">
                                    "{personalizedSuggestions}"
                                </p>
                            )}
                        </div>

                        <h3 className="text-2xl font-bold text-yellow-300 mb-4 border-b-2 border-yellow-500 pb-2 flex items-center">
                            <span className="mr-3">🛍️</span> Tienda de Recompensas
                        </h3>
                        <p className="text-gray-300 mb-6">
                            ¡Gasta tu Oro en beneficios y premios que puedes aplicar en tu vida!
                            Estas son ideas, ¡puedes crear las tuyas en tu mente o en tus notas!
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Impulso de Vitalidad */}
                            <div className="bg-gray-700 p-4 rounded-lg shadow-md flex flex-col justify-between border border-gray-600">
                                <div>
                                    <h4 className="text-lg font-bold text-white mb-1">Impulso de Vitalidad (+20 Vitalidad)</h4>
                                    <p className="text-gray-300 text-sm mb-3">
                                        Siente un aumento significativo en tu energía. Útil cuando te sientas agotado.
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleBuyReward(40, () => addVitality(20), '¡Recompensa: +20 Vitalidad canjeado!')}
                                    className={`
                                        bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow-md mt-auto
                                        ${playerStats.gold < 40 ? 'opacity-50 cursor-not-allowed' : ''}
                                    `}
                                    disabled={playerStats.gold < 40}
                                >
                                    Comprar (💰 40 Oro)
                                </button>
                            </div>
                            {/* Comodín de Tarea */}
                            <div className="bg-gray-700 p-4 rounded-lg shadow-md flex flex-col justify-between border border-gray-600">
                                <div>
                                    <h4 className="text-lg font-bold text-white mb-1">Comodín de Tarea</h4>
                                    <p className="text-gray-300 text-sm mb-3">
                                        Omite una subtarea pequeña o menos importante de tu misión actual.
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleBuyReward(75, () => showMessage('¡Has usado un Comodín de Tarea! Elige una subtarea para omitir.'), '¡Recompensa: Comodín de Tarea canjeado!')}
                                    className={`
                                        bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg shadow-md mt-auto
                                        ${playerStats.gold < 75 ? 'opacity-50 cursor-not-allowed' : ''}
                                    `}
                                    disabled={playerStats.gold < 75}
                                >
                                    Comprar (💰 75 Oro)
                                </button>
                            </div>
                            {/* Hora de Ocio Extra */}
                            <div className="bg-gray-700 p-4 rounded-lg shadow-md flex flex-col justify-between border border-gray-600">
                                <div>
                                    <h4 className="text-lg font-bold text-white mb-1">Hora de Ocio Extra</h4>
                                    <p className="text-gray-300 text-sm mb-3">
                                        Gana una hora extra para dedicar a tus hobbies, sin culpas.
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleBuyReward(60, () => showMessage('¡Disfruta tu hora de ocio extra!'), '¡Recompensa: Hora de Ocio Extra canjeado!')}
                                    className={`
                                        bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg shadow-md mt-auto
                                        ${playerStats.gold < 60 ? 'opacity-50 cursor-not-allowed' : ''}
                                    `}
                                    disabled={playerStats.gold < 60}
                                >
                                    Comprar (💰 60 Oro)
                                </button>
                            </div>
                            {/* Día de Descanso Merecido */}
                            <div className="bg-gray-700 p-4 rounded-lg shadow-md flex flex-col justify-between border border-gray-600">
                                <div>
                                    <h4 className="text-lg font-bold text-white mb-1">Día de Descanso Merecido</h4>
                                    <p className="text-gray-300 text-sm mb-3">
                                        ¡Una recompensa épica! Tómate un día completo libre de todas tus responsabilidades.
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleBuyReward(200, () => showMessage('¡Has canjeado un Día de Descanso Merecido! Relájate y recarga energías.'), '¡Recompensa: Día de Descanso Merecido canjeado!')}
                                    className={`
                                        bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-md mt-auto
                                        ${playerStats.gold < 200 ? 'opacity-50 cursor-not-allowed' : ''}
                                    `}
                                    disabled={playerStats.gold < 200}
                                >
                                    Comprar (💰 200 Oro)
                                </button>
                            </div>
                            {/* Comida Favorita */}
                            <div className="bg-gray-700 p-4 rounded-lg shadow-md flex flex-col justify-between border border-gray-600">
                                <div>
                                    <h4 className="text-lg font-bold text-white mb-1">Comida Favorita</h4>
                                    <p className="text-gray-300 text-sm mb-3">
                                        Date un gusto con tu comida o snack favorito.
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleBuyReward(25, () => showMessage('¡Disfruta tu comida favorita!'), '¡Recompensa: Comida Favorita canjeado!')}
                                    className={`
                                        bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-lg shadow-md mt-auto
                                        ${playerStats.gold < 25 ? 'opacity-50 cursor-not-allowed' : ''}
                                    `}
                                    disabled={playerStats.gold < 25}
                                >
                                    Comprar (� 25 Oro)
                                </button>
                            </div>
                            {/* Mejora de Concentración (Pomodoro extra) */}
                            <div className="bg-gray-700 p-4 rounded-lg shadow-md flex flex-col justify-between border border-gray-600">
                                <div>
                                    <h4 className="text-lg font-bold text-white mb-1">Mejora de Concentración (Pomodoro)</h4>
                                    <p className="text-gray-300 text-sm mb-3">
                                        Gana un Pomodoro extra para usar en cualquier momento del día.
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleBuyReward(50, () => showMessage('¡Has ganado un Pomodoro extra! Úsalo sabiamente.'), '¡Recompensa: Mejora de Concentración canjeado!')}
                                    className={`
                                        bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded-lg shadow-md mt-auto
                                        ${playerStats.gold < 50 ? 'opacity-50 cursor-not-allowed' : ''}
                                    `}
                                    disabled={playerStats.gold < 50}
                                >
                                    Comprar (💰 50 Oro)
                                </button>
                            </div>
                            {/* New: Aumentar Vitalidad Máxima */}
                            <div className="bg-gray-700 p-4 rounded-lg shadow-md flex flex-col justify-between border border-gray-600">
                                <div>
                                    <h4 className="text-lg font-bold text-white mb-1">Aumentar Vitalidad Máxima (+10)</h4>
                                    <p className="text-gray-300 text-sm mb-3">
                                        Incrementa tu capacidad máxima de Vitalidad, haciéndote más resistente.
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleBuyReward(100, () => {
                                        setPlayerStats(prevStats => {
                                            const newMaxVitality = prevStats.maxVitality + 10;
                                            const updatedStats = { ...prevStats, maxVitality: newMaxVitality, vitality: Math.min(prevStats.vitality, newMaxVitality) }; // Cap current vitality
                                            updatePlayerStats(updatedStats);
                                            return updatedStats;
                                        });
                                    }, '¡Recompensa: Vitalidad Máxima aumentada!')}
                                    className={`
                                        bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg shadow-md mt-auto
                                        ${playerStats.gold < 100 ? 'opacity-50 cursor-not-allowed' : ''}
                                    `}
                                    disabled={playerStats.gold < 100}
                                >
                                    Comprar (💰 100 Oro)
                                </button>
                            </div>
                        </div>
                    </section>
                )}

                {activeTab === 'achievements' && (
                    <section className="p-6 bg-gray-800 bg-opacity-70 rounded-xl shadow-lg border-2 border-blue-500">
                        <h2 className="text-3xl font-bold text-blue-300 mb-4 border-b-2 border-blue-500 pb-2 flex items-center">
                            <span className="mr-3">🏆</span> Tus Logros
                        </h2>
                        <p className="text-gray-300 mb-6">
                            ¡Celebra tus hitos! Cada logro desbloqueado es una prueba de tu progreso en LifeQuest.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {allAchievements.map(achievement => (
                                <div
                                    key={achievement.id}
                                    className={`p-4 rounded-lg shadow-md flex flex-col items-center text-center
                                        ${playerStats.achievements.includes(achievement.id) ? 'bg-green-700 border-2 border-green-400' : 'bg-gray-700 border-2 border-gray-600 opacity-70 grayscale'}
                                    `}
                                >
                                    <span className="text-4xl mb-2">
                                        {playerStats.achievements.includes(achievement.id) ? '🏅' : '❓'}
                                    </span>
                                    <h4 className="text-lg font-bold text-white mb-1">{achievement.name}</h4>
                                    <p className="text-gray-300 text-sm">{achievement.description}</p>
                                    {playerStats.achievements.includes(achievement.id) && (
                                        <button
                                            onClick={() => generateAndSaveAchievementImage(achievement)}
                                            disabled={isGeneratingAchievementImage}
                                            className="bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white text-xs font-bold py-1 px-2 rounded-lg shadow-md transform transition-transform duration-200 hover:scale-105 mt-2 flex items-center justify-center space-x-1"
                                        >
                                            {isGeneratingAchievementImage && selectedAchievementForImage?.id === achievement.id ? (
                                                <>
                                                    <span className="animate-spin inline-block">⏳</span>
                                                    <span>Generando...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="text-base">🖼️</span>
                                                    <span>Guardar Imagen</span>
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        {isGeneratingAchievementImage && selectedAchievementForImage && (
                            <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
                                <div className="bg-gray-900 rounded-xl p-8 shadow-2xl w-full max-w-md text-center">
                                    <h3 className="text-2xl font-bold text-white mb-4">Generando Imagen de Logro...</h3>
                                    <p className="text-gray-300 mb-4">Esto puede tardar unos segundos.</p>
                                    <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-purple-500 mx-auto"></div>
                                </div>
                            </div>
                        )}
                        {generatedAchievementImageUrl && !isGeneratingAchievementImage && (
                            <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
                                <div className="bg-gray-900 rounded-xl p-8 shadow-2xl w-full max-w-md text-center relative">
                                    <button
                                        onClick={() => setGeneratedAchievementImageUrl(null)}
                                        className="absolute top-4 right-4 text-gray-400 hover:text-white text-lg"
                                    >
                                        X
                                    </button>
                                    <h3 className="text-2xl font-bold text-white mb-4">¡Imagen de Logro Generada!</h3>
                                    <img src={generatedAchievementImageUrl} alt="Generated Achievement" className="mx-auto rounded-lg shadow-xl border-2 border-gray-700 max-w-full h-auto" />
                                    <p className="text-gray-400 text-sm mt-4">La imagen se ha descargado automáticamente.</p>
                                </div>
                            </div>
                        )}
                    </section>
                )}
            </main>

            {showObjectiveForm && (
                <ObjectiveForm
                    onSave={handleSaveObjective}
                    onCancel={() => { setShowObjectiveForm(false); setEditingObjective(null); }}
                    objectiveToEdit={editingObjective}
                />
            )}

            {/* Mobile Fixed Bottom Navigation */}
            <nav className="fixed bottom-0 left-0 right-0 bg-gray-800 bg-opacity-95 p-2 shadow-lg flex justify-around z-50 md:hidden border-t border-gray-700">
                <button
                    onClick={() => handleSetActiveTab('missions')}
                    className={`flex flex-col items-center text-xs py-1 px-2 rounded-lg transition-colors duration-200 ${activeTab === 'missions' ? 'text-purple-400' : 'text-gray-300 hover:text-white'}`}
                >
                    <i className="fas fa-scroll text-xl mb-1"></i> {/* Icon for Missions */}
                    <span>Misiones</span>
                </button>
                <button
                    onClick={() => handleSetActiveTab('profile')}
                    className={`flex flex-col items-center text-xs py-1 px-2 rounded-lg transition-colors duration-200 ${activeTab === 'profile' ? 'text-purple-400' : 'text-gray-300 hover:text-white'}`}
                >
                    <i className="fas fa-user text-xl mb-1"></i> {/* Icon for Profile */}
                    <span>Perfil</span>
                </button>
                <button
                    onClick={() => handleSetActiveTab('rewards')}
                    className={`flex flex-col items-center text-xs py-1 px-2 rounded-lg transition-colors duration-200 ${activeTab === 'rewards' ? 'text-purple-400' : 'text-gray-300 hover:text-white'}`}
                >
                    <i className="fas fa-gift text-xl mb-1"></i> {/* Icon for Rewards */}
                    <span>Recompensas</span>
                </button>
                <button
                    onClick={() => handleSetActiveTab('achievements')}
                    className={`flex flex-col items-center text-xs py-1 px-2 rounded-lg transition-colors duration-200 ${activeTab === 'achievements' ? 'text-purple-400' : 'text-gray-300 hover:text-white'}`}
                >
                    <i className="fas fa-trophy text-xl mb-1"></i> {/* Icon for Achievements */}
                    <span>Logros</span>
                </button>
            </nav>
        </div>
    );
};

export default App;
�