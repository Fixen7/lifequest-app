/* global __firebase_config, __app_id, __initial_auth_token */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, onSnapshot, query, deleteDoc, setDoc } from 'firebase/firestore';
import * as Tone from 'tone';

// --- CONSTANTES Y CONFIGURACIÓN INICIAL ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-lifequest-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Instrumentos de Tone.js
const successSynth = new Tone.Synth().toDestination();
// (Añade el resto de tus synths si los usas)

const INITIAL_PLAYER_STATS = { level: 1, xp: 0, xpToNextLevel: 100, gold: 0, vitality: 100, maxVitality: 100, currentSatisfaction: 50, satisfactionHistory: [], lastDailyRewardClaim: null, currentStreak: 0, lastStreakDate: null, achievements: [], hasCompletedTutorial: false, pomodoroCount: 0, dailyDesireCount: 0 };

// --- COMPONENTES HIJOS (MOVIDOS FUERA DE APP Y MEMOIZADOS) ---

const ObjectiveCard = React.memo(({ objective, onSelect, onEdit, onDelete }) => {
    // Tu código JSX de ObjectiveCard
    const difficultyColors = { Fácil: 'bg-green-500', Normal: 'bg-yellow-500', Difícil: 'bg-red-500', Épico: 'bg-purple-500' };
    return (
        <div className={`p-4 rounded-lg mb-4 ${objective.isCurrent ? 'border-2 border-yellow-400' : ''}`} style={{ backgroundColor: '#2D3748' }}>
            <h3 className="text-xl font-bold">{objective.name}</h3>
            <p className="text-gray-400">{objective.description}</p>
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${difficultyColors[objective.difficulty] || 'bg-gray-500'}`}>{objective.difficulty}</span>
            <div className="mt-4 flex space-x-2">
                <button className="bg-blue-500 px-3 py-1 rounded" onClick={() => onSelect(objective.id)}>Seleccionar</button>
                <button className="bg-yellow-500 px-3 py-1 rounded" onClick={() => onEdit(objective)}>Editar</button>
                <button className="bg-red-500 px-3 py-1 rounded" onClick={() => onDelete(objective.id)}>Eliminar</button>
            </div>
        </div>
    );
});

const ObjectiveForm = React.memo(({ onSave, onCancel, objectiveToEdit, showMessage }) => {
    const [name, setName] = useState(objectiveToEdit?.name || '');
    const [description, setDescription] = useState(objectiveToEdit?.description || '');
    const [difficulty, setDifficulty] = useState(objectiveToEdit?.difficulty || 'Normal');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) {
            showMessage("El nombre no puede estar vacío.");
            return;
        }
        onSave({ name, description, difficulty });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
            <div className="bg-gray-800 p-8 rounded-lg w-full max-w-md">
                <form onSubmit={handleSubmit}>
                    <h2 className="text-2xl mb-4">{objectiveToEdit ? 'Editar Objetivo' : 'Nuevo Objetivo'}</h2>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del Objetivo" className="w-full p-2 mb-4 bg-gray-700 rounded"/>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción" className="w-full p-2 mb-4 bg-gray-700 rounded h-24"></textarea>
                    <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="w-full p-2 mb-4 bg-gray-700 rounded">
                        <option>Fácil</option>
                        <option>Normal</option>
                        <option>Difícil</option>
                        <option>Épico</option>
                    </select>
                    <div className="flex justify-end space-x-4">
                        <button type="button" onClick={onCancel} className="bg-gray-600 px-4 py-2 rounded">Cancelar</button>
                        <button type="submit" className="bg-green-600 px-4 py-2 rounded">Guardar</button>
                    </div>
                </form>
            </div>
        </div>
    );
});


// --- COMPONENTE PRINCIPAL APP ---
const App = () => {
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [objectives, setObjectives] = useState([]);
    const [playerStats, setPlayerStats] = useState(INITIAL_PLAYER_STATS); // Usamos la constante
    const [showObjectiveForm, setShowObjectiveForm] = useState(false);
    const [editingObjective, setEditingObjective] = useState(null);
    const [message, setMessage] = useState('');
    const messageTimeoutRef = useRef(null);

    // --- FUNCIONES ---
    const showMessage = useCallback((msg) => {
        if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
        setMessage(msg);
        messageTimeoutRef.current = setTimeout(() => setMessage(''), 3000);
    }, []);
    
    const handleSaveObjective = useCallback(async (objectiveData) => {
        if (!db || !userId) return;
        try {
            if (editingObjective) {
                const objectiveRef = doc(db, `artifacts/${appId}/users/${userId}/objectives`, editingObjective.id);
                await updateDoc(objectiveRef, objectiveData);
                showMessage("Objetivo actualizado.");
            } else {
                await addDoc(collection(db, `artifacts/${appId}/users/${userId}/objectives`), {
                    ...objectiveData,
                    isCurrent: false,
                    isCompleted: false,
                    createdAt: new Date(),
                });
                showMessage("Objetivo creado.");
            }
            setShowObjectiveForm(false);
            setEditingObjective(null);
        } catch (e) {
            console.error(e);
            showMessage("Error al guardar el objetivo.");
        }
    }, [db, userId, editingObjective, showMessage]);

    const handleSelectObjective = useCallback(async (selectedObjectiveId) => {
        if (!db || !userId) return;
        try {
            const batchUpdates = objectives.map(obj => {
                const objRef = doc(db, `artifacts/${appId}/users/${userId}/objectives`, obj.id);
                return updateDoc(objRef, { isCurrent: obj.id === selectedObjectiveId });
            });
            await Promise.all(batchUpdates);
            showMessage("Objetivo actual seleccionado.");
        } catch (e) {
            console.error("Error seleccionando objetivo:", e);
            showMessage("Error al seleccionar objetivo.");
        }
    }, [db, userId, objectives, showMessage]);

    const handleDeleteObjective = useCallback(async (objectiveId) => {
        if (!db || !userId) return;
        if (!window.confirm("¿Estás seguro de que quieres eliminar este objetivo?")) return;
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/objectives`, objectiveId));
            showMessage("Objetivo eliminado.");
            successSynth.triggerAttackRelease("C4", "8n");
        } catch (e) {
            console.error("Error eliminando objetivo:", e);
            showMessage("Error al eliminar objetivo.");
        }
    }, [db, userId, showMessage]);


    // --- USEEFFECTS ---

    // Inicialización de Firebase
    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);
            setDb(firestoreDb);

            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    if (initialAuthToken) {
                        await signInWithCustomToken(firebaseAuth, initialAuthToken);
                    } else {
                        await signInAnonymously(firebaseAuth);
                    }
                }
                setLoading(false);
            });
            return () => unsubscribe();
        } catch (error) {
            console.error("Firebase Init Error:", error);
            setLoading(false);
        }
    }, []);

    // Listeners de Firestore
    useEffect(() => {
        if (!db || !userId) return;

        // Listener para Objetivos
        const objectivesQuery = query(collection(db, `artifacts/${appId}/users/${userId}/objectives`));
        const unsubscribeObjectives = onSnapshot(objectivesQuery, (snapshot) => {
            const fetchedObjectives = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setObjectives(fetchedObjectives);
        }, (error) => console.error(error));

        // Listener para Estadísticas del Jugador
        const playerStatsDocRef = doc(db, `artifacts/${appId}/users/${userId}/playerStats`, 'mainStats');
        const unsubscribePlayerStats = onSnapshot(playerStatsDocRef, (docSnap) => {
            if (docSnap.exists()) {
                setPlayerStats(docSnap.data());
            } else {
                setDoc(playerStatsDocRef, INITIAL_PLAYER_STATS); // Crea el documento si no existe
            }
        }, (error) => console.error(error));

        return () => {
            unsubscribeObjectives();
            unsubscribePlayerStats();
        };
    }, [db, userId]);

    // --- RENDERIZADO ---
    if (loading) {
        return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">Cargando...</div>;
    }

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            {message && <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-blue-600 px-6 py-2 rounded-full z-50">{message}</div>}

            <header className="text-center mb-8">
                <h1 className="text-4xl font-bold">LifeQuest</h1>
                <p>Tu aventura de vida</p>
            </header>

            <main className="max-w-4xl mx-auto">
                <div className="flex justify-end mb-4">
                    <button
                        onClick={() => {
                            setEditingObjective(null);
                            setShowObjectiveForm(true);
                        }}
                        className="bg-green-600 px-4 py-2 rounded-lg"
                    >
                        + Nuevo Objetivo
                    </button>
                </div>
                
                <section>
                    <h2 className="text-2xl font-semibold mb-4">Misiones</h2>
                    {objectives.length > 0 ? (
                        objectives.map(obj => (
                            <ObjectiveCard
                                key={obj.id}
                                objective={obj}
                                onSelect={handleSelectObjective}
                                onEdit={(objToEdit) => {
                                    setEditingObjective(objToEdit);
                                    setShowObjectiveForm(true);
                                }}
                                onDelete={handleDeleteObjective}
                            />
                        ))
                    ) : (
                        <p className="text-gray-500">No tienes misiones. ¡Crea una para empezar!</p>
                    )}
                </section>

                <section className="mt-8">
                    <h2 className="text-2xl font-semibold mb-4">Estadísticas del Jugador</h2>
                    <div className="bg-gray-800 p-4 rounded-lg">
                        <p>Nivel: {playerStats.level}</p>
                        <p>XP: {playerStats.xp} / {playerStats.xpToNextLevel}</p>
                        <p>Oro: {playerStats.gold}</p>
                        <p>Vitalidad: {playerStats.vitality} / {playerStats.maxVitality}</p>
                    </div>
                </section>

            </main>

            {showObjectiveForm && (
                <ObjectiveForm
                    onSave={handleSaveObjective}
                    onCancel={() => setShowObjectiveForm(false)}
                    objectiveToEdit={editingObjective}
                    showMessage={showMessage}
                />
            )}
        </div>
    );
};

export default App;