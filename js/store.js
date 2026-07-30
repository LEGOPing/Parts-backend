let selectedRepository = null;
let selectedBox = null;
let editingRepository = null;
let editingBox = null;

function setSelectedRepository(repo) {
    selectedRepository = repo;
}

function getSelectedRepository() {
    return selectedRepository;
}

function setSelectedBox(box) {
    selectedBox = box;
}

function getSelectedBox() {
    return selectedBox;
}

function setEditingRepository(repo) {
    editingRepository = repo;
}

function getEditingRepository() {
    return editingRepository;
}

function setEditingBox(box) {
    editingBox = box;
}

function getEditingBox() {
    return editingBox;
}

function clearSelection() {
    selectedRepository = null;
    selectedBox = null;
}

async function saveToLocalStorage(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
        console.error('保存到本地存储失败:', error);
    }
}

async function loadFromLocalStorage(key) {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('从本地存储加载失败:', error);
        return null;
    }
}

async function syncData() {
    try {
        const repos = await getRepositories();
        await saveToLocalStorage('repositories', repos);
        
        if (selectedRepository) {
            const boxes = await getBoxes(selectedRepository.id);
            await saveToLocalStorage(`boxes_${selectedRepository.id}`, boxes);
            
            if (selectedBox) {
                const parts = await getParts(selectedBox.id);
                await saveToLocalStorage(`parts_${selectedBox.id}`, parts);
            }
        }
    } catch (error) {
        console.error('数据同步失败:', error);
    }
}