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

let boxTransferMode = false;
let selectedTransferBoxes = [];

function setBoxTransferMode(mode) {
    boxTransferMode = mode;
}

function getBoxTransferMode() {
    return boxTransferMode;
}

function setSelectedTransferBoxes(boxes) {
    selectedTransferBoxes = boxes;
}

function getSelectedTransferBoxes() {
    return selectedTransferBoxes;
}

function clearSelection() {
    selectedRepository = null;
    selectedBox = null;
}

// ==================== 灰卡白平衡校准 ====================
let grayCardGains = null; // { r, g, b } 白平衡增益系数
let grayCardCalibrated = false;
let grayCardCalibrationActive = false; // 是否启用灰卡校准

function getGrayCardGains() {
    return grayCardGains;
}

function setGrayCardGains(gains) {
    grayCardGains = gains;
    grayCardCalibrated = gains !== null;
    // 持久化保存
    saveToLocalStorage('gray_card_gains', gains);
}

function isGrayCardCalibrated() {
    return grayCardCalibrated;
}

function isGrayCardCalibrationActive() {
    return grayCardCalibrationActive;
}

function setGrayCardCalibrationActive(active) {
    grayCardCalibrationActive = active;
    saveToLocalStorage('gray_card_active', active);
}

function resetGrayCardCalibration() {
    grayCardGains = null;
    grayCardCalibrated = false;
    grayCardCalibrationActive = false;
    saveToLocalStorage('gray_card_gains', null);
    saveToLocalStorage('gray_card_active', false);
}

// 初始化时从 localStorage 恢复状态
(function initGrayCardState() {
    loadFromLocalStorage('gray_card_gains').then(gains => {
        if (gains) {
            grayCardGains = gains;
            grayCardCalibrated = true;
        }
    });
    loadFromLocalStorage('gray_card_active').then(active => {
        grayCardCalibrationActive = active === true;
    });
})();

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