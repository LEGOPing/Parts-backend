function calculateP() {
    try {
        const testElement = document.createElement('div');
        testElement.style.width = '1in';
        testElement.style.height = '1in';
        testElement.style.position = 'absolute';
        testElement.style.visibility = 'hidden';
        document.body.appendChild(testElement);
        
        const dpi = testElement.offsetWidth;
        document.body.removeChild(testElement);
        
        const p = (8 / 25.4) * dpi;
        return Math.round(p);
    } catch (error) {
        return 30;
    }
}

async function switchTab(tabName, btn) {
    // 进入系统设置需要密码
    if (tabName === 'settings' && !pwWheelState.settingsUnlocked) {
        showPasswordWheel({
            rounds: 1,
            messages: ['请输入密码进入系统设置'],
            onSuccess: () => {
                pwWheelState.settingsUnlocked = true;
                switchTab('settings', btn);
            }
        });
        return;
    }
    if (tabName !== 'settings') {
        pwWheelState.settingsUnlocked = false;
    }

    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    document.querySelectorAll('.nav button').forEach(button => {
        button.classList.remove('active');
    });
    if (btn) {
        btn.classList.add('active');
    }
    
    if (tabName === 'repositories') {
        await loadRepositories();
    } else if (tabName === 'parts') {
        if (selectedBox) {
            loadParts(selectedBox.id);
        }
    } else if (tabName === 'search') {
        clearSearchResults();
    } else if (tabName === 'settings') {
        loadStats();
    }
}

let isLoadingRepositories = false;

async function loadRepositories() {
    if (isLoadingRepositories) return;
    isLoadingRepositories = true;
    
    try {
        let repos = await getRepositories();
        
        // 清理重复仓库：按name分组，保留第一个，合并其他仓库的盒子到第一个，然后删除重复仓库
        const nameGroups = {};
        repos.forEach(r => {
            if (!nameGroups[r.name]) nameGroups[r.name] = [];
            nameGroups[r.name].push(r);
        });
        
        for (const [name, group] of Object.entries(nameGroups)) {
            if (group.length > 1) {
                const keepRepo = group[0];
                const duplicateRepos = group.slice(1);
                
                for (const dupRepo of duplicateRepos) {
                    try {
                        // 获取重复仓库的所有盒子
                        const dupBoxes = await getBoxes(dupRepo.id);
                        
                        // 将盒子转移到保留的仓库
                        for (const box of dupBoxes) {
                            await updateBox(box.id, { repository_id: keepRepo.id });
                        }
                        
                        // 删除空仓库
                        await deleteRepository(dupRepo.id);
                        console.log(`已清理重复仓库: ${name} (ID: ${dupRepo.id})`);
                    } catch (err) {
                        console.error(`清理仓库失败: ${name}`, err);
                    }
                }
            }
        }
        
        // 重新获取仓库列表
        repos = await getRepositories();
        
        // 清理旧的"待定盒子"仓库（如果存在）
        const oldPendingRepo = repos.find(r => r.name === '待定盒子');
        if (oldPendingRepo) {
            try {
                await deleteRepository(oldPendingRepo.id);
                console.log('已清理旧的"待定盒子"仓库');
                repos = await getRepositories();
            } catch (e) {
                console.error('清理"待定盒子"仓库失败:', e);
            }
        }
        
        // 按name去重（保留第一个）
        const seen = new Set();
        repos = repos.filter(r => {
            if (seen.has(r.name)) return false;
            seen.add(r.name);
            return true;
        });
        
        // 确保临时仓库存在
        let tempRepo = repos.find(r => r.name === '临时仓库');
        if (!tempRepo) {
            tempRepo = await createRepository('临时仓库');
            if (tempRepo) {
                repos = await getRepositories();
                // 再次去重
                const seen2 = new Set();
                repos = repos.filter(r => {
                    if (seen2.has(r.name)) return false;
                    seen2.add(r.name);
                    return true;
                });
            }
        }
        
        // 确保临时仓库中有临时盒子
        if (tempRepo) {
            let tempBoxes = await getBoxes(tempRepo.id);
            let tempBox = tempBoxes.find(b => b.name === '临时盒子');
            if (!tempBox) {
                // 查找最大box_number
                const maxBoxNumber = tempBoxes.reduce((max, b) => Math.max(max, b.box_number || 0), 0);
                await createBox(tempRepo.id, maxBoxNumber + 1, '临时盒子');
            }
        }
        
        // 确保临时仓库排在最后
        repos.sort((a, b) => {
            if (a.name === '临时仓库') return 1;
            if (b.name === '临时仓库') return -1;
            return a.id - b.id;
        });
        
        const uniqueRepos = repos.filter((repo, index, self) => 
            index === self.findIndex(r => r.id === repo.id)
        );
        const list = document.getElementById('repositories-list');
        list.innerHTML = '';
        
        document.getElementById('repository-count').textContent = uniqueRepos.length;
        
        const boxCounts = {};
        await Promise.all(uniqueRepos.map(async repo => {
            const boxes = await getBoxes(repo.id);
            // 去重：与 loadBoxes() 保持一致
            const seenIds = new Set();
            const seenBoxNums = new Set();
            const uniqueBoxes = boxes.filter(box => {
                if (seenIds.has(box.id)) return false;
                const key = `${box.box_number}_${box.name}`;
                if (seenBoxNums.has(key)) return false;
                seenIds.add(box.id);
                seenBoxNums.add(key);
                return true;
            });
            boxCounts[repo.id] = uniqueBoxes.length;
        }));
        
        uniqueRepos.forEach(repo => {
            const card = document.createElement('div');
            card.className = `repository-card ${selectedRepository && selectedRepository.id === repo.id ? 'selected' : ''}`;
            card.dataset.id = repo.id;
            
            const isTemp = repo.name === '临时仓库';
            const deleteBtn = isTemp ? '' : `<button class="repo-delete-btn" onclick="event.stopPropagation(); deleteRepositoryConfirm('${repo.id}')">×</button>`;
            
            card.innerHTML = `
                ${deleteBtn}
                <div class="repo-card-name">${repo.name}</div>
                <div class="repo-card-footer">
                    <span class="repo-id">ID: ${repo.id}</span>
                    <span class="repo-box-count"><span class="count">${boxCounts[repo.id]}</span> <span class="unit">B</span></span>
                </div>
            `;
            
            card.addEventListener('click', () => {
                if (!editingRepository) {
                    selectRepository(repo);
                }
            });
            
            if (!isTemp) {
                setupLongPress(card, () => {
                    if (repo.name !== '临时仓库') {
                        startEditRepository(card, repo);
                    }
                });
            }
            
            list.appendChild(card);
        });
    } finally {
        isLoadingRepositories = false;
    }
}

async function selectRepository(repo) {
    setSelectedRepository(repo);
    
    document.querySelectorAll('.repository-card').forEach(card => {
        card.classList.remove('selected');
        card.style.backgroundColor = '';
        if (parseInt(card.dataset.id) === repo.id || card.dataset.id === String(repo.id)) {
            card.classList.add('selected');
            // 直接设置内联样式，确保优先级最高
            card.style.backgroundColor = '#F2CD37';
        }
    });
    
    document.getElementById('box-management').style.display = 'block';
    document.getElementById('no-repository-selected').style.display = 'none';
    
    document.getElementById('selected-repository-name').textContent = `${repo.name} - 盒子管理`;
    
    await loadBoxes(repo.id);
}

function startEditRepository(card, repo) {
    setEditingRepository(repo);
    
    card.innerHTML = `
        <input type="text" value="${repo.name}" class="repo-edit-input" />
        <div class="repo-card-footer">
            <span class="repo-id">ID: ${repo.id}</span>
            <span class="repo-box-count"><span class="count">0</span> <span class="unit">B</span></span>
        </div>
    `;
    
    const input = card.querySelector('.repo-edit-input');
    input.focus();
    input.select();
    
    input.addEventListener('blur', () => {
        saveRepositoryName(card, repo.id, input.value);
    });
    
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveRepositoryName(card, repo.id, input.value);
        }
    });
}

async function saveRepositoryName(card, id, name) {
    if (name.trim() === '') {
        name = '新仓库';
    }
    
    const success = await updateRepository(id, { name: name.trim() });
    setEditingRepository(null);
    
    if (success) {
        await loadRepositories();
        if (selectedRepository && selectedRepository.id === id) {
            selectedRepository.name = name.trim();
            document.getElementById('selected-repository-name').textContent = `${name.trim()} - 盒子管理`;
        }
    } else {
        await loadRepositories();
    }
}

async function addRepository() {
    console.log('addRepository called');
    try {
        const existingRepos = await getRepositories();
        
        // 生成唯一名称，避免与现有仓库名称冲突
        const existingNames = existingRepos.map(r => r.name);
        let newName = '新仓库';
        let counter = 1;
        while (existingNames.includes(newName)) {
            newName = `新仓库${counter}`;
            counter++;
        }
        
        // 计算下一个ID：最大ID + 1
        const maxId = existingRepos.reduce((max, r) => Math.max(max, r.id), -1);
        const nextId = maxId + 1;
        
        const newRepo = await createRepository(newName, nextId);
        if (newRepo) {
            await loadRepositories();
            setTimeout(() => {
                selectRepository(newRepo);
            }, 100);
        } else {
            alert('添加仓库失败：数据库未返回结果，请稍后重试');
        }
    } catch (error) {
        console.error('添加仓库异常:', error);
        alert('添加仓库失败：' + error.message);
    }
}

async function deleteRepositoryConfirm(id) {
    showPasswordWheel({
        rounds: 3,
        messages: ['请输入删除密码（第 1/3 次）', '请再次输入密码（第 2/3 次）', '请再次输入密码（第 3/3 次）'],
        onSuccess: async () => {
            // 查找要删除的仓库
            const repos = await getRepositories();
            const repoToDelete = repos.find(r => r.id === parseInt(id));
            if (!repoToDelete) {
                alert('仓库不存在');
                return;
            }

            // 被删仓库中的盒子
            const boxes = await getBoxes(parseInt(id));

            // 有盒子时：全部转移到临时仓库并重排盒子ID；无盒子时可直接删除
            let tempRepo = null;
            if (boxes.length > 0) {
                // 查找或创建临时仓库
                tempRepo = repos.find(r => r.name === '临时仓库');
                if (!tempRepo) {
                    tempRepo = await createRepository('临时仓库');
                    if (!tempRepo) {
                        alert('创建临时仓库失败');
                        return;
                    }
                }
            }

            // 显示删除确认提示
            const confirmMsg = boxes.length > 0
                ? `删除后，原仓库「${repoToDelete.name}」的 ${boxes.length} 个盒子将转入「临时仓库」并重新编号，确认删除吗？`
                : `确定要删除空仓库「${repoToDelete.name}」吗？`;
            if (!confirm(confirmMsg)) {
                return;
            }

            // 有盒子时：将盒子转移到临时仓库，并重排盒子ID（与原 ID 冲突的重新编号）
            if (boxes.length > 0 && tempRepo) {
                // 注意：Supabase int8(bigint) 会以字符串返回，统一转字符串 key，避免重复判断失效
                const numKey = (n) => (n === null || n === undefined || n === '') ? null : String(n);
                const targetBoxes = await getBoxes(tempRepo.id);
                const usedNumbers = new Set(targetBoxes.map(b => numKey(b.box_number)).filter(k => k !== null));

                // 按当前 ID 排序，尽量保留原 ID，冲突时分配下一个可用 ID
                const sortedBoxes = [...boxes].sort((a, b) => (parseInt(a.box_number, 10) || 0) - (parseInt(b.box_number, 10) || 0));
                let maxNumber = targetBoxes.reduce((max, b) => {
                    const n = parseInt(b.box_number, 10);
                    return isNaN(n) ? max : Math.max(max, n);
                }, 0);

                for (const box of sortedBoxes) {
                    let newNumber = box.box_number;
                    if (!numKey(newNumber) || usedNumbers.has(numKey(newNumber))) {
                        maxNumber += 1;
                        newNumber = maxNumber;
                    }
                    usedNumbers.add(numKey(newNumber));
                    await updateBox(box.id, { repository_id: tempRepo.id, box_number: newNumber });
                }
            }

            // 删除仓库
            const success = await deleteRepository(id);
            if (success) {
                if (selectedRepository && selectedRepository.id === parseInt(id)) {
                    // 当前选中的是被删仓库：切到临时仓库（无盒子转移时切到剩余第一个仓库）
                    const reposAfter = await getRepositories();
                    const nextRepo = tempRepo ? reposAfter.find(r => r.id === tempRepo.id) : null;
                    const target = nextRepo || reposAfter[0];
                    if (target) {
                        setSelectedRepository(target);
                        await loadBoxes(target.id);
                        document.getElementById('box-management').style.display = 'block';
                        document.getElementById('no-repository-selected').style.display = 'none';
                        document.getElementById('selected-repository-name').textContent = `${target.name} - 盒子管理`;
                    }
                }
                await loadRepositories();
            }
        }
    });
}

async function loadBoxes(repoId) {
    let boxes = await getBoxes(repoId);
    const grid = document.getElementById('boxes-list');
    grid.innerHTML = '';
    
    // 去重：按id去重，同时按box_number+name去重
    const seenIds = new Set();
    const seenBoxNums = new Set();
    const uniqueBoxes = boxes.filter(box => {
        if (seenIds.has(box.id)) return false;
        const key = `${box.box_number}_${box.name}`;
        if (seenBoxNums.has(key)) return false;
        seenIds.add(box.id);
        seenBoxNums.add(key);
        return true;
    });
    
    document.getElementById('box-count').textContent = uniqueBoxes.length;
    
    const partCounts = {};
    await Promise.all(uniqueBoxes.map(async box => {
        const parts = await getParts(box.id);
        partCounts[box.id] = parts.length;
    }));
    
    uniqueBoxes.forEach(box => {
        const transferMode = getBoxTransferMode();
        const isSelectedForTransfer = transferMode && getSelectedTransferBoxes().some(b => b.id === box.id);
        const card = document.createElement('div');
        card.className = `box-card ${box.name === '新盒子' ? 'default' : ''} ${isSelectedForTransfer ? 'transfer-selected' : ''}`;
        card.dataset.id = box.id;
        
        const isTempBox = box.name === '临时盒子';
        const deleteBtn = (isTempBox || transferMode) ? '' : `<button class="box-delete-btn" onclick="event.stopPropagation(); deleteBoxConfirm('${box.id}')">×</button>`;
        const checkBadge = `<div class="box-check-badge" style="display:${isSelectedForTransfer ? 'flex' : 'none'};">✓</div>`;
        
        card.innerHTML = `
                ${deleteBtn}
                ${checkBadge}
                <div class="box-card-name">${box.name}</div>
                <div class="box-card-footer">
                    <span class="box-id">ID: ${box.box_number}</span>
                    <span class="box-part-count"><span class="count">${partCounts[box.id]}</span> <span class="unit">T</span></span>
                </div>
            `;
        
        card.addEventListener('click', () => {
            if (getBoxTransferMode()) {
                toggleTransferBoxSelection(box, card);
                return;
            }
            if (!editingBox) {
                setSelectedBox(box);
                document.getElementById('selected-box-name').textContent = box.name;
                
                // 显示仓库名称徽章、@符号和序号
                const repoBadgeWrapper = document.getElementById('repo-badge-wrapper');
                const repoText = document.getElementById('repo-name-text');
                const repoAt = document.getElementById('repo-at');
                if (selectedRepository && repoBadgeWrapper && repoText) {
                    repoText.textContent = selectedRepository.name;
                    repoBadgeWrapper.style.display = 'inline-flex';
                    if (repoAt) repoAt.style.display = 'inline';
                }
                
                // 更新选中状态样式
                document.querySelectorAll('.box-card').forEach(c => {
                    c.classList.remove('selected');
                    c.style.backgroundColor = '';
                });
                card.classList.add('selected');
                card.style.backgroundColor = '#F2CD37';
                
                const btn = document.querySelector('.part-btn');
                switchTab('parts', btn);
            }
        });
        
        if (!transferMode) {
            setupLongPress(card, () => {
                if (box.name !== '临时盒子') {
                    startEditBox(card, box);
                }
            });
        }
        
        grid.appendChild(card);
    });
}

// ===== 盒子转仓 =====
async function toggleBoxTransferMode() {
    const mode = !getBoxTransferMode();
    setBoxTransferMode(mode);
    if (mode) {
        setSelectedTransferBoxes([]);
    }
    
    const btn = document.getElementById('transfer-box-btn');
    const toolbar = document.getElementById('transfer-toolbar');
    if (btn) btn.textContent = mode ? '取消转仓' : '盒子转仓';
    if (toolbar) toolbar.style.display = mode ? 'flex' : 'none';
    const targetBtn = document.getElementById('transfer-target-btn');
    if (targetBtn) {
        targetBtn.disabled = true;
        targetBtn.textContent = '选择目标仓库(0)';
    }
    
    if (selectedRepository) {
        await loadBoxes(selectedRepository.id);
    }
}

function toggleTransferBoxSelection(box, card) {
    if (box.name === '临时盒子') {
        alert('临时盒子不可转仓');
        return;
    }
    const selected = getSelectedTransferBoxes();
    const idx = selected.findIndex(b => b.id === box.id);
    if (idx >= 0) {
        selected.splice(idx, 1);
        card.classList.remove('transfer-selected');
        card.querySelector('.box-check-badge').style.display = 'none';
    } else {
        selected.push(box);
        card.classList.add('transfer-selected');
        card.querySelector('.box-check-badge').style.display = 'flex';
    }
    setSelectedTransferBoxes(selected);
    
    const targetBtn = document.getElementById('transfer-target-btn');
    if (targetBtn) {
        targetBtn.textContent = `选择目标仓库(${selected.length})`;
        targetBtn.disabled = selected.length === 0;
    }
}

function showTransferTargetPicker() {
    const boxes = getSelectedTransferBoxes();
    if (boxes.length === 0) {
        alert('请先选择需要转仓的盒子');
        return;
    }
    if (!selectedRepository) return;
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    
    const sheet = document.createElement('div');
    sheet.className = 'modal-content transfer-target-modal';
    
    let repoListHtml = '';
    getRepositories().then(repos => {
        // 排除当前仓库和临时仓库
        const candidates = repos.filter(r => r.id !== selectedRepository.id && r.name !== '临时仓库');
        if (candidates.length === 0) {
            sheet.innerHTML = `
                <div class="transfer-target-header">
                    <span class="transfer-target-title">盒子转仓</span>
                    <button class="transfer-target-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="transfer-target-empty">没有可用的目标仓库</div>
            `;
            overlay.appendChild(sheet);
            document.body.appendChild(overlay);
            return;
        }
        candidates.forEach((repo, i) => {
            repoListHtml += `
                <label class="transfer-repo-option ${i === 0 ? 'checked' : ''}">
                    <input type="radio" name="transfer-target-repo" value="${repo.id}" ${i === 0 ? 'checked' : ''}>
                    <span>${repo.name}</span>
                </label>
            `;
        });
        sheet.innerHTML = `
            <div class="transfer-target-header">
                <span class="transfer-target-title">选择目标仓库（已选 ${boxes.length} 个盒子）</span>
                <button class="transfer-target-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <div class="transfer-target-list">${repoListHtml}</div>
            <button class="transfer-confirm-btn" onclick="performBoxTransfer()">确认转仓</button>
        `;
        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
    });
}

async function performBoxTransfer() {
    const radio = document.querySelector('input[name="transfer-target-repo"]:checked');
    if (!radio) {
        alert('请选择目标仓库');
        return;
    }
    const targetRepoId = parseInt(radio.value);
    const boxes = getSelectedTransferBoxes();

    // 第一步：确认转移
    if (!confirm(`确定将 ${boxes.length} 个盒子转入所选仓库吗？`)) {
        return;
    }

    // 关闭目标仓库选择弹窗，避免转仓完成后仍在页面上残留
    const targetModal = document.querySelector('.transfer-target-modal');
    if (targetModal) {
        const overlay = targetModal.closest('.modal-overlay');
        if (overlay) overlay.remove();
    }

    // 第二步：密码验证
    showPasswordWheel({
        rounds: 2,
        messages: ['请输入转仓密码（第 1/2 次）', '请再次输入密码确认（第 2/2 次）'],
        onSuccess: async () => {
            try {
                // 获取目标仓库已有盒子，收集已占用的 box_number
                // 注意：Supabase int8(bigint) 列会以字符串返回，统一转字符串 key，避免 Set 严格相等检测失效导致重复 ID
                const numKey = (n) => (n === null || n === undefined || n === '') ? null : String(n);
                const targetBoxes = await getBoxes(targetRepoId);
                const usedNumbers = new Set(targetBoxes.map(b => numKey(b.box_number)).filter(k => k !== null));
                
                // 按当前 ID 排序，尽量保留原 ID
                const sortedBoxes = [...boxes].sort((a, b) => (parseInt(a.box_number, 10) || 0) - (parseInt(b.box_number, 10) || 0));
                let maxNumber = targetBoxes.reduce((max, b) => {
                    const n = parseInt(b.box_number, 10);
                    return isNaN(n) ? max : Math.max(max, n);
                }, 0);
                
                let renumbered = 0;
                for (const box of sortedBoxes) {
                    let newNumber = box.box_number;
                    // 原 ID 被占用或无效时，分配目标仓库下一个可用 ID
                    if (!numKey(newNumber) || usedNumbers.has(numKey(newNumber))) {
                        maxNumber += 1;
                        newNumber = maxNumber;
                        renumbered++;
                    }
                    usedNumbers.add(numKey(newNumber));
                    const success = await updateBox(box.id, { repository_id: targetRepoId, box_number: newNumber });
                    if (!success) {
                        throw new Error(`盒子 ${box.name || box.box_number} 更新失败`);
                    }
                }
                
                // 退出转仓模式并重置 UI
                setBoxTransferMode(false);
                setSelectedTransferBoxes([]);
                const btn = document.getElementById('transfer-box-btn');
                const toolbar = document.getElementById('transfer-toolbar');
                if (btn) btn.textContent = '盒子转仓';
                if (toolbar) toolbar.style.display = 'none';
                
                // 获取目标仓库名称用于成功提示
                let targetRepoName = '目标仓库';
                try {
                    const repos = await getRepositories();
                    const targetRepo = repos.find(r => r.id == targetRepoId);
                    if (targetRepo) targetRepoName = targetRepo.name;
                } catch (e) {}
                
                // 提示成功信息，2 秒后自动进入目标仓库管理页面
                const msg = `${boxes.length} 个盒子已经转入 ${targetRepoName} 仓库` + (renumbered > 0 ? `（其中 ${renumbered} 个盒子因 ID 冲突已重新编号）` : '');
                showToast(msg, 2000);
                
                setTimeout(async () => {
                    await loadRepositories();
                    const repos = await getRepositories();
                    const targetRepo = repos.find(r => r.id == targetRepoId);
                    if (targetRepo) {
                        await selectRepository(targetRepo);
                    }
                }, 2000);
            } catch (error) {
                console.error('转仓失败:', error);
                alert('转仓失败：' + error.message);
            }
        }
    });
}

function startEditBox(card, box) {
    setEditingBox(box);
    
    card.innerHTML = `
        <input type="text" value="${box.name}" class="box-edit-input" />
        <div class="box-card-footer">
            <span class="box-id">ID: ${box.box_number}</span>
            <span class="box-part-count"><span class="count">0</span> <span class="unit">T</span></span>
        </div>
    `;
    
    const input = card.querySelector('.box-edit-input');
    input.focus();
    input.select();
    
    input.addEventListener('blur', () => {
        saveBoxName(card, box.id, input.value);
    });
    
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveBoxName(card, box.id, input.value);
        }
    });
}

async function saveBoxName(card, id, name) {
    if (name.trim() === '') {
        name = '新盒子';
    }
    
    const success = await updateBox(id, { name: name.trim() });
    setEditingBox(null);
    
    if (success && selectedRepository) {
        await loadBoxes(selectedRepository.id);
    }
}

async function addBox() {
    if (!selectedRepository) {
        alert('请先选择一个仓库');
        return;
    }
    
    const boxes = await getBoxes(selectedRepository.id);
    const maxBoxNumber = boxes.reduce((max, box) => Math.max(max, box.box_number || 0), 0);
    const newBoxNumber = maxBoxNumber + 1;
    
    const newBox = await createBox(selectedRepository.id, newBoxNumber, '新盒子');
    if (newBox && selectedRepository) {
        await loadBoxes(selectedRepository.id);
        await loadRepositories();
    }
}

async function deleteBoxConfirm(id) {
    // 查找盒子信息
    const boxes = await getBoxes();
    const boxToDelete = boxes.find(b => b.id === parseInt(id));
    if (boxToDelete && boxToDelete.name === '临时盒子') {
        alert('临时盒子不可删除');
        return;
    }

    showPasswordWheel({
        rounds: 2,
        messages: ['请输入密码以删除盒子（第 1/2 次）', '请再次输入密码确认（第 2/2 次）'],
        onSuccess: async () => {
            // 被删盒子中的零件
            const parts = await getParts(parseInt(id));

            // 有零件时需先确认转入临时盒子
            const confirmMsg = parts.length > 0
                ? `删除后，盒子「${boxToDelete ? boxToDelete.name : ''}」内的 ${parts.length} 个零件将转入「临时仓库」的「临时盒子」，确定要删除吗？`
                : '确定要删除这个盒子吗？';
            if (!confirm(confirmMsg)) {
                return;
            }

            // 有零件时：全部转移到临时仓库的临时盒子，再删除盒子
            if (parts.length > 0) {
                try {
                    // 查找或创建临时仓库
                    let tempRepo = (await getRepositories()).find(r => r.name === '临时仓库');
                    if (!tempRepo) {
                        tempRepo = await createRepository('临时仓库');
                    }
                    if (!tempRepo) {
                        alert('创建临时仓库失败，盒子未删除');
                        return;
                    }

                    // 查找或创建临时盒子
                    let tempBoxes = await getBoxes(tempRepo.id);
                    let tempBox = tempBoxes.find(b => b.name === '临时盒子');
                    if (!tempBox) {
                        // 查找最大box_number
                        const maxBoxNumber = tempBoxes.reduce((max, b) => Math.max(max, b.box_number || 0), 0);
                        tempBox = await createBox(tempRepo.id, maxBoxNumber + 1, '临时盒子');
                    }
                    if (!tempBox) {
                        alert('创建临时盒子失败，盒子未删除');
                        return;
                    }

                    // 将零件全部转移到临时盒子
                    const moved = await updatePartsByBox(parseInt(id), { box_id: tempBox.id });
                    if (!moved) {
                        alert('转移零件到临时盒子失败，盒子未删除');
                        return;
                    }
                } catch (error) {
                    console.error('转移零件到临时盒子失败:', error);
                    alert('转移零件到临时盒子失败，盒子未删除：' + error.message);
                    return;
                }
            }

            // 删除盒子
            const success = await deleteBox(id);
            if (success && selectedRepository) {
                await loadBoxes(selectedRepository.id);
                await loadRepositories();
            }
        }
    });
}

async function loadParts(boxId) {
    // 更新盒子序号显示
    await updateBoxSequence();
    
    const parts = await getParts(boxId);
    // 只从 RB 数据库获取颜色
    const colors = await getAllColors();
    const colorMap = {};
    colors.forEach(c => colorMap[c.id] = c);
    
    const list = document.getElementById('parts-list');
    list.innerHTML = '';
    
    document.getElementById('part-count').textContent = parts.length;
    
    parts.forEach(async (part) => {
        const card = document.createElement('div');
        card.className = 'part-card';
        card.dataset.id = part.id;
        
        const color = colorMap[part.color_id];
        const colorName = color ? color.name : '未知颜色';
        
        card.innerHTML = `
            <div class="part-num">${part.part_num}</div>
            <div class="part-image">
                <div class="no-image" style="display:flex;">加载中...</div>
            </div>
            <div class="part-name">${part.name}</div>
            <div class="part-color">${colorName}</div>
            <div class="part-info">
                <span class="part-new-status ${part.is_new ? 'new' : 'used'}">${part.is_new ? '新' : '旧'}</span>
                <span class="part-quantity ${part.quantity >= 50 ? 'qty-green' : part.quantity >= 10 ? 'qty-orange' : 'qty-red'}">${part.quantity}</span>
            </div>
        `;
        
        // 异步加载图片
        const imgUrl = await getPartImageUrl(part.part_num, part.color_id);
        const imageContainer = card.querySelector('.part-image');
        if (imgUrl) {
            imageContainer.innerHTML = `<img src="${imgUrl}" alt="${part.name}" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=no-image>暂无图片</div>'">`;
        } else {
            imageContainer.innerHTML = '<div class="no-image">暂无图片</div>';
        }
        
        card.addEventListener('click', () => {
            showPartDetail(part);
        });
        
        list.appendChild(card);
    });
}

// ===== 零件转盒 =====
let partTransferSelected = new Set();      // 已选中的零件 id
let partTransferTargetRepo = null;         // 目标仓库对象
let partTransferTargetBox = null;          // 目标盒子对象
let partTransferBoxesCache = {};           // repoId -> boxes 缓存

// 打开零件转盒弹窗
async function showPartTransferModal() {
    if (!selectedBox || !selectedRepository) {
        alert('请先选择需要转盒的零件所在盒子');
        return;
    }

    // 重置状态
    partTransferSelected = new Set();
    partTransferTargetRepo = null;
    partTransferTargetBox = null;
    partTransferBoxesCache = {};

    const parts = await getParts(selectedBox.id);
    if (parts.length === 0) {
        alert('当前盒子没有零件可转盒');
        return;
    }
    // 允许转移到同仓库的其他盒子，因此不排除当前仓库；仅排除临时仓库
    const repos = (await getRepositories()).filter(r => r.name !== '临时仓库');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'part-transfer-overlay';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closePartTransferModal();
    });

    const sheet = document.createElement('div');
    sheet.className = 'modal-content part-transfer-modal';
    sheet.innerHTML = `
        <div class="part-transfer-header">
            <span class="part-transfer-title">零件转盒</span>
            <span class="part-transfer-count" id="pt-selected-count">已选 0 个零件</span>
        </div>
        <div class="part-transfer-body">
            <div class="pt-section">
                <div class="pt-section-title">选择需要转盒的零件（可多选）</div>
                <div class="pt-part-grid" id="pt-parts-grid"></div>
            </div>
            <div class="pt-target-section">
                <div class="pt-row">
                    <div class="pt-row-label">仓库</div>
                    <div class="pt-row-scroll" id="pt-repo-row"></div>
                </div>
                <div class="pt-row">
                    <div class="pt-row-label">盒子</div>
                    <div class="pt-row-scroll" id="pt-box-row"></div>
                </div>
            </div>
        </div>
        <div class="part-transfer-footer">
            <button class="btn-secondary" onclick="closePartTransferModal()">取消</button>
            <button class="btn-primary pt-confirm-btn" onclick="performPartTransfer()">确认转盒</button>
        </div>
    `;
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    renderPartTransferParts(parts);
    renderPartTransferRepos(repos);
}

// 渲染零件选择卡片（多选）
async function renderPartTransferParts(parts) {
    const grid = document.getElementById('pt-parts-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const colors = await getAllColors();
    const colorMap = {};
    colors.forEach(c => colorMap[c.id] = c);

    for (const part of parts) {
        const color = colorMap[part.color_id];
        const colorName = color ? color.name : '未知颜色';
        const card = document.createElement('div');
        card.className = 'pt-part-card';
        card.dataset.id = part.id;
        card.innerHTML = `
            <div class="pt-part-num">${part.part_num}</div>
            <div class="pt-part-image"><div class="no-image">暂无图片</div></div>
            <div class="pt-part-name">${part.name}</div>
            <div class="pt-part-info">
                <span class="pt-part-status ${part.is_new ? 'new' : 'used'}">${part.is_new ? '新' : '旧'}</span>
                <span class="pt-part-qty">x${part.quantity}</span>
            </div>
            <div class="pt-part-check"></div>
        `;
        const imgUrl = await getPartImageUrl(part.part_num, part.color_id);
        const imgBox = card.querySelector('.pt-part-image');
        if (imgUrl) {
            imgBox.innerHTML = `<img src="${imgUrl}" alt="${part.name}" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=no-image>暂无图片</div>'">`;
        }
        card.addEventListener('click', () => togglePartTransferSelection(part.id, card));
        grid.appendChild(card);
    }
}

// 零件多选切换
function togglePartTransferSelection(partId, card) {
    if (partTransferSelected.has(partId)) {
        partTransferSelected.delete(partId);
        card.classList.remove('selected');
    } else {
        partTransferSelected.add(partId);
        card.classList.add('selected');
    }
    const countEl = document.getElementById('pt-selected-count');
    if (countEl) countEl.textContent = `已选 ${partTransferSelected.size} 个零件`;
}

// 渲染仓库行（横向滚动，单选）
function renderPartTransferRepos(repos) {
    const row = document.getElementById('pt-repo-row');
    if (!row) return;
    row.innerHTML = '';
    if (repos.length === 0) {
        row.innerHTML = '<div class="pt-row-empty">没有可用的目标仓库</div>';
        return;
    }
    repos.forEach(repo => {
        const item = document.createElement('div');
        item.className = 'pt-repo-card';
        item.dataset.id = repo.id;
        item.textContent = repo.name;
        item.title = repo.name;
        item.addEventListener('click', () => selectPartTransferRepo(repo, item));
        row.appendChild(item);
    });
}

// 选中仓库并加载其盒子
async function selectPartTransferRepo(repo, card) {
    partTransferTargetRepo = repo;
    partTransferTargetBox = null;
    document.querySelectorAll('#pt-repo-row .pt-repo-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');

    let boxes = partTransferBoxesCache[repo.id];
    if (!boxes) {
        boxes = await getBoxes(repo.id);
        partTransferBoxesCache[repo.id] = boxes;
    }
    renderPartTransferBoxes(boxes);
}

// 渲染盒子行（横向滚动，单选）
function renderPartTransferBoxes(boxes) {
    const row = document.getElementById('pt-box-row');
    if (!row) return;
    row.innerHTML = '';
    if (!boxes || boxes.length === 0) {
        row.innerHTML = '<div class="pt-row-empty">该仓库暂无盒子</div>';
        return;
    }
    boxes.forEach(box => {
        const item = document.createElement('div');
        item.className = 'pt-box-card';
        item.dataset.id = box.id;
        item.textContent = box.name || '';
        item.title = box.name || '';
        item.addEventListener('click', () => {
            partTransferTargetBox = box;
            document.querySelectorAll('#pt-box-row .pt-box-card').forEach(c => c.classList.remove('selected'));
            item.classList.add('selected');
        });
        row.appendChild(item);
    });
}

// 执行零件转盒
async function performPartTransfer() {
    if (partTransferSelected.size === 0) {
        alert('请先选择需要转盒的零件');
        return;
    }
    if (!partTransferTargetBox) {
        alert('请选择目标盒子');
        return;
    }
    const ids = Array.from(partTransferSelected);
    const boxName = partTransferTargetBox.name || partTransferTargetBox.box_number;
    if (!confirm(`确定将 ${ids.length} 个零件转移到 "${boxName}" 盒子吗？`)) {
        return;
    }

    // 记录目标盒子信息，用于转盒成功后的跳转
    const targetBox = partTransferTargetBox;
    const targetRepoId = targetBox.repository_id;

    // 先关闭目标盒子选择弹窗
    closePartTransferModal();

    let successCount = 0;
    for (const id of ids) {
        const ok = await updatePart(id, { box_id: targetBox.id });
        if (ok) successCount++;
    }

    if (successCount === 0) {
        alert('转盒失败，请重试');
        return;
    }

    // 提示成功消息，2秒后关闭提示，然后进入目标盒子
    showToast(`转盒成功：${successCount} 个零件已转移到目标盒子`, 2000);
    setTimeout(() => enterTargetBox(targetBox, targetRepoId), 2000);
}

// 转盒成功后进入目标盒子，显示该盒子内的零件
async function enterTargetBox(targetBox, targetRepoId) {
    // 切换到目标盒子所在仓库
    const repos = await getRepositories();
    const targetRepo = repos.find(r => r.id === targetRepoId);
    if (targetRepo) {
        setSelectedRepository(targetRepo);
        const selectedRepoNameEl = document.getElementById('selected-repository-name');
        if (selectedRepoNameEl) {
            selectedRepoNameEl.textContent = `${targetRepo.name} - 盒子管理`;
        }
    }

    // 选中目标盒子并更新标题
    setSelectedBox(targetBox);
    const boxNameEl = document.getElementById('selected-box-name');
    if (boxNameEl) boxNameEl.textContent = targetBox.name;

    // 显示仓库名称徽章
    const repoBadgeWrapper = document.getElementById('repo-badge-wrapper');
    const repoText = document.getElementById('repo-name-text');
    const repoAt = document.getElementById('repo-at');
    if (selectedRepository && repoBadgeWrapper && repoText) {
        repoText.textContent = selectedRepository.name;
        repoBadgeWrapper.style.display = 'inline-flex';
        if (repoAt) repoAt.style.display = 'inline';
    }

    // 确保零件页处于激活状态并加载目标盒子零件
    const partsTab = document.getElementById('parts-tab');
    if (partsTab && !partsTab.classList.contains('active')) {
        switchTab('parts', document.querySelector('.part-btn'));
    } else {
        await loadParts(targetBox.id);
    }
}

// 关闭零件转盒弹窗
function closePartTransferModal() {
    const overlay = document.getElementById('part-transfer-overlay');
    if (overlay) overlay.remove();
    partTransferSelected = new Set();
    partTransferTargetRepo = null;
    partTransferTargetBox = null;
    partTransferBoxesCache = {};
}

// 获取当前仓库的去重盒子列表（按 box_number 排序）
async function getSortedBoxes() {
    if (!selectedRepository) return [];
    const boxes = await getBoxes(selectedRepository.id);
    // 去重：与 loadBoxes() 保持一致
    const seenIds = new Set();
    const seenBoxNums = new Set();
    const uniqueBoxes = boxes.filter(box => {
        if (seenIds.has(box.id)) return false;
        const key = `${box.box_number}_${box.name}`;
        if (seenBoxNums.has(key)) return false;
        seenIds.add(box.id);
        seenBoxNums.add(key);
        return true;
    });
    uniqueBoxes.sort((a, b) => (a.box_number || 0) - (b.box_number || 0));
    return uniqueBoxes;
}

// 更新盒子序号显示
async function updateBoxSequence() {
    const seqEl = document.getElementById('box-sequence');
    if (!seqEl) return;
    
    if (!selectedBox || !selectedRepository) {
        seqEl.textContent = '';
        return;
    }
    
    const boxes = await getSortedBoxes();
    const currentIndex = boxes.findIndex(b => b.id === selectedBox.id);
    if (currentIndex === -1) {
        seqEl.textContent = '';
        return;
    }
    
    seqEl.textContent = `${currentIndex + 1}/${boxes.length}`;
}

// 左右滑动切换盒子（按 box_number 顺序）
async function switchBox(direction) {
    if (!selectedBox || !selectedRepository) return;
    
    const boxes = await getSortedBoxes();
    if (boxes.length <= 1) return;
    
    const currentIndex = boxes.findIndex(b => b.id === selectedBox.id);
    if (currentIndex === -1) return;
    
    let targetIndex;
    if (direction === 'next') {
        targetIndex = currentIndex + 1;
        if (targetIndex >= boxes.length) {
            showToast('已是最后一个盒子');
            return;
        }
    } else {
        targetIndex = currentIndex - 1;
        if (targetIndex < 0) {
            showToast('已是第一个盒子');
            return;
        }
    }
    
    const targetBox = boxes[targetIndex];
    setSelectedBox(targetBox);
    document.getElementById('selected-box-name').textContent = targetBox.name;
    
    // 添加滑动动画
    const wrapper = document.querySelector('.part-grid-wrapper');
    if (wrapper) {
        wrapper.classList.remove('slide-left', 'slide-right');
        void wrapper.offsetWidth; // 触发重排以重置动画
        wrapper.classList.add(direction === 'next' ? 'slide-left' : 'slide-right');
    }
    
    await loadParts(targetBox.id);
}

// 初始化零件页滑动手势
function initPartsSwipeGesture() {
    const partsTab = document.getElementById('parts-tab');
    if (!partsTab) return;
    
    let startX = 0, startY = 0, isTracking = false;
    const SWIPE_THRESHOLD = 60; // 最小滑动距离
    
    partsTab.addEventListener('touchstart', (e) => {
        if (!selectedBox) return;
        // 只在零件管理页面激活时追踪
        if (!partsTab.classList.contains('active')) return;
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        isTracking = true;
    }, { passive: true });
    
    partsTab.addEventListener('touchend', (e) => {
        if (!isTracking || !selectedBox) {
            isTracking = false;
            return;
        }
        isTracking = false;
        
        const touch = e.changedTouches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        
        // 水平滑动且距离足够
        if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx < 0) {
                switchBox('next');
            } else {
                switchBox('prev');
            }
        }
    }, { passive: true });
}

// 轻量提示
function showToast(msg, duration = 1500) {
    let toast = document.getElementById('swipe-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'swipe-toast';
        toast.className = 'swipe-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

function setupLongPress(element, callback) {
    let longPressTimer;
    
    const start = () => {
        longPressTimer = setTimeout(callback, 800);
    };
    
    const end = () => {
        clearTimeout(longPressTimer);
    };
    
    element.addEventListener('mousedown', start);
    element.addEventListener('mouseup', end);
    element.addEventListener('mouseleave', end);
    element.addEventListener('touchstart', start);
    element.addEventListener('touchend', end);
}

// 更新搜索结果卡片中对应零件的数量
function updateSearchResultQuantity(partId, quantity) {
    const card = document.querySelector(`.search-result-card[data-part-id="${partId}"]`);
    if (!card) return;
    const qtyEl = card.querySelector('.src-qty');
    if (!qtyEl) return;
    qtyEl.textContent = quantity;
    qtyEl.classList.remove('qty-red', 'qty-orange', 'qty-green');
    let cls = 'qty-red';
    if (quantity >= 50) cls = 'qty-green';
    else if (quantity >= 10) cls = 'qty-orange';
    qtyEl.classList.add(cls);
}

function showAddPartSheet() {
    if (!selectedBox) {
        alert('请先选择一个盒子');
        return;
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'add-part-overlay';
    
    const sheet = document.createElement('div');
    sheet.className = 'modal-content add-part-modal';
    
    sheet.innerHTML = `
        <div class="modal-header">
            <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">取消</button>
            <span class="modal-title">添加零件</span>
            <button class="btn-save" onclick="saveNewPart(this)">保存</button>
        </div>
        <div class="modal-body add-part-body">
            <div class="form-section">
                <div class="form-row part-number-row">
                    <label class="form-label">零件型号：</label>
                    <div class="part-number-input-wrapper">
                        <input type="text" id="new-part-num" class="form-input" placeholder="请输入零件型号" autocomplete="off" />
                        <div class="part-number-suggestions" id="part-number-suggestions"></div>
                        <span class="part-name-hint" id="part-name-hint"></span>
                    </div>
                    <button type="button" class="btn-recognize" onclick="recognizePartFromPhoto()">识别</button>
                </div>
            </div>
            <div class="form-section">
                <div class="form-row part-name-row">
                    <label class="form-label">零件名称：</label>
                    <div class="part-name-input-wrapper">
                        <input type="text" id="new-part-name" class="form-input" placeholder="请输入零件名称" autocomplete="off" />
                        <div class="part-name-suggestions" id="part-name-suggestions"></div>
                    </div>
                </div>
                <div class="form-row">
                    <label class="form-label">零件颜色：</label>
                    <input type="text" id="new-part-color" class="form-input" placeholder="请输入颜色ID" oninput="updateColorButtonColor(this.value)" />
                    <button id="color-pick-btn" class="btn-color-pick" onclick="showColorPicker()">选择颜色</button>
                </div>
            </div>
            <div class="form-section">
                <div class="quantity-weight-row">
                    <label class="form-label">零件数量：</label>
                    <div class="quantity-input-row">
                        <input type="number" id="new-part-quantity" class="form-input" placeholder="请输入数量" value="1" />
                        <button class="btn-weight-calc" onclick="showWeightCalculator()">称重计算</button>
                    </div>
                </div>
                <div class="quantity-weight-row">
                    <label class="form-label">零件状态：</label>
                    <div class="status-group">
                        <button id="status-new" class="status-btn active" onclick="togglePartNewStatus(true)">新品</button>
                        <button id="status-used" class="status-btn" onclick="togglePartNewStatus(false)">旧品</button>
                    </div>
                </div>
            </div>
            <div class="part-info-preview" id="part-info-preview" style="display: none;"></div>
            <div id="add-part-error" style="color: red; font-size: 12px; display: none; padding: 10px; background: rgba(255, 0, 0, 0.1); border-radius: 4px;"></div>
            <div class="recognize-result" id="recognize-result"></div>
        </div>
    `;
    
    // 隐藏相机输入与识别结果容器（随弹窗一起销毁）
    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.id = 'recognize-camera-input';
    cameraInput.accept = 'image/*';
    cameraInput.style.display = 'none';
    cameraInput.addEventListener('change', () => processRecognitionFile(cameraInput));
    document.body.appendChild(cameraInput);
    
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    
    window.newPartIsNew = true;
    
    // 初始化联想功能
    initAddPartSuggestions();
}

// 初始化添加零件的联想功能
function initAddPartSuggestions() {
    const partNumInput = document.getElementById('new-part-num');
    const partNameInput = document.getElementById('new-part-name');
    const partNumSuggestions = document.getElementById('part-number-suggestions');
    const partNameSuggestions = document.getElementById('part-name-suggestions');
    const partNameHint = document.getElementById('part-name-hint');
    const partInfoPreview = document.getElementById('part-info-preview');
    
    let partNumTimer = null;
    let partNameTimer = null;
    let partMatchTimer = null;
    let currentWordIndex = 0;
    
    // 隐藏联想建议
    function hidePartNumSuggestions() {
        partNumSuggestions.style.display = 'none';
        partNumSuggestions.innerHTML = '';
    }
    
    function hidePartNameSuggestions() {
        partNameSuggestions.style.display = 'none';
        partNameSuggestions.innerHTML = '';
    }
    
    // 显示零件型号联想
    async function showPartNumSuggestions(query) {
        if (!query || query.trim().length === 0) {
            hidePartNumSuggestions();
            return;
        }
        
        if (query.length > 10) {
            hidePartNumSuggestions();
            return;
        }
        
        const suggestions = await searchPartsByNumber(query, 30);
        
        if (suggestions.length === 0) {
            hidePartNumSuggestions();
            return;
        }
        
        partNumSuggestions.innerHTML = suggestions.map(s => `
            <div class="part-number-suggestion-item" data-part-num="${s.part_num}" data-part-name="${s.name}">
                <span class="suggestion-num">${s.part_num}</span>
                <span class="suggestion-name">${s.name}</span>
            </div>
        `).join('');
        partNumSuggestions.style.display = 'block';
        
        // 绑定点击事件
        partNumSuggestions.querySelectorAll('.part-number-suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const partNum = item.dataset.partNum;
                const partName = item.dataset.partName;
                
                partNumInput.value = partNum;
                hidePartNumSuggestions();
                
                if (partName) {
                    partNameInput.value = partName;
                    partNameHint.textContent = '';
                }
                
                updatePartInfoPreview();
            });
        });
    }
    
    // 显示零件名称联想
    async function showPartNameSuggestions(query, wordIndex, previousWords) {
        const suggestions = await getPartNameSuggestions(query, wordIndex, previousWords, 30);
        
        if (suggestions.length === 0) {
            hidePartNameSuggestions();
            return;
        }
        
        // 分组显示
        const groups = {};
        suggestions.forEach(s => {
            let key;
            if (/x/i.test(s)) {
                const match = s.match(/^(\d+)/);
                key = match ? match[1] : s[0].toUpperCase();
            } else if (/^\d/.test(s)) {
                key = s.split(' ')[0];
            } else {
                key = s[0].toUpperCase();
            }
            if (!groups[key]) groups[key] = [];
            groups[key].push(s);
        });
        
        let html = '';
        Object.keys(groups).sort((a, b) => {
            const numA = parseInt(a), numB = parseInt(b);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            if (!isNaN(numA)) return -1;
            if (!isNaN(numB)) return 1;
            return a.localeCompare(b);
        }).forEach(key => {
            html += `<div class="suggestion-group"><span class="suggestion-group-key">${key}</span><div class="suggestion-group-items">`;
            groups[key].forEach(word => {
                html += `<span class="part-name-suggestion-word">${word}</span>`;
            });
            html += '</div></div>';
        });
        
        partNameSuggestions.innerHTML = html;
        partNameSuggestions.style.display = 'block';
        
        // 绑定点击事件
        partNameSuggestions.querySelectorAll('.part-name-suggestion-word').forEach(wordEl => {
            wordEl.addEventListener('click', () => {
                const selectedWord = wordEl.textContent;
                const currentValue = partNameInput.value;
                const endsWithSpace = currentValue.endsWith(' ');
                const words = currentValue.split(/\s+/).filter(w => w);
                
                if (endsWithSpace || words.length === 0) {
                    words.push(selectedWord);
                } else {
                    words[words.length - 1] = selectedWord;
                }
                
                partNameInput.value = words.join(' ') + ' ';
                partNameHint.textContent = selectedWord;
                
                hidePartNameSuggestions();
                
                // 更新单词索引
                currentWordIndex = words.length;
                
                // 触发下一个单词的联想
                if (partNameInput.value.trim()) {
                    triggerPartNameSuggestions();
                    triggerPartMatch();
                }
            });
        });
    }
    
    // 获取当前单词和之前的单词
    function getWordInfo(text) {
        if (!text) return { words: [], currentWord: '', currentIndex: 0 };
        
        const tokens = text.split(/\s+/).filter(t => t);
        const words = [];
        let i = 0;
        
        while (i < tokens.length) {
            const token = tokens[i];
            
            if (i + 2 < tokens.length && 
                !isNaN(parseInt(token)) && 
                tokens[i + 1].toLowerCase() === 'x' && 
                !isNaN(parseInt(tokens[i + 2]))) {
                words.push(`${token} ${tokens[i + 1]} ${tokens[i + 2]}`);
                i += 3;
            } else if (!isNaN(parseInt(token))) {
                const numTokens = [token];
                let j = i + 1;
                while (j < tokens.length && !isNaN(parseInt(tokens[j]))) {
                    numTokens.push(tokens[j]);
                    j++;
                }
                if (numTokens.length > 1) {
                    words.push(numTokens.join(' '));
                    i = j;
                } else {
                    words.push(token);
                    i++;
                }
            } else {
                words.push(token);
                i++;
            }
        }
        
        const endsWithSpace = text.endsWith(' ');
        const currentIndex = endsWithSpace ? words.length : Math.max(0, words.length - 1);
        const currentWord = endsWithSpace ? '' : (words[words.length - 1] || '');
        
        return { words, currentWord, currentIndex };
    }
    
    // 触发零件名称联想
    function triggerPartNameSuggestions() {
        const input = partNameInput.value;
        const { words, currentWord, currentIndex } = getWordInfo(input);
        
        currentWordIndex = currentIndex;
        
        if (input.length > 100) return;
        
        clearTimeout(partNameTimer);
        partNameTimer = setTimeout(() => {
            showPartNameSuggestions(currentWord, currentIndex, words);
        }, 300);
    }
    
    // 触发零件型号匹配
    function triggerPartMatch() {
        const input = partNameInput.value;
        const cleanInput = input.trim();
        
        if (!cleanInput || cleanInput.length > 100) return;
        
        clearTimeout(partMatchTimer);
        partMatchTimer = setTimeout(async () => {
            const partNum = await matchPartNumberFromName(cleanInput);
            if (partNum) {
                partNumInput.value = partNum;
                updatePartInfoPreview();
            }
        }, 1000);
    }
    
    // 根据型号更新零件信息预览
    async function updatePartInfoPreview() {
        const partNum = partNumInput.value.trim();
        if (!partNum) {
            partInfoPreview.style.display = 'none';
            return;
        }
        
        const part = await getPartByNum(partNum);
        if (part) {
            if (!partNameInput.value) {
                partNameInput.value = part.name || '';
            }
            
            const colorCount = await getPartColorCount(partNum);
            partInfoPreview.innerHTML = `
                <div class="part-preview-item">
                    <span class="preview-label">型号</span>
                    <span class="preview-value">${part.part_num}</span>
                </div>
                <div class="part-preview-item">
                    <span class="preview-label">名称</span>
                    <span class="preview-value">${part.name || '-'}</span>
                </div>
                ${colorCount > 0 ? `<div class="part-preview-item"><span class="preview-label">可用颜色</span><span class="preview-value">${colorCount} 种</span></div>` : ''}
            `;
            partInfoPreview.style.display = 'block';
        } else {
            partInfoPreview.style.display = 'none';
        }
    }
    
    // 零件型号输入事件
    partNumInput.addEventListener('input', () => {
        const value = partNumInput.value;
        
        // 清除之前的定时器
        clearTimeout(partNumTimer);
        clearTimeout(partMatchTimer);
        
        if (!value) {
            hidePartNumSuggestions();
            partNameHint.textContent = '';
            partInfoPreview.style.display = 'none';
            return;
        }
        
        if (value.length > 10) {
            hidePartNumSuggestions();
            return;
        }
        
        // 延迟触发联想查询（不自动选择）
        partNumTimer = setTimeout(async () => {
            await showPartNumSuggestions(value);
        }, 800);
    });
    
    // 零件名称输入事件
    partNameInput.addEventListener('input', () => {
        const value = partNameInput.value;
        
        clearTimeout(partNameTimer);
        clearTimeout(partMatchTimer);
        
        partNameHint.textContent = '';
        
        if (!value) {
            hidePartNameSuggestions();
            return;
        }
        
        if (value.length > 100) {
            hidePartNameSuggestions();
            return;
        }
        
        triggerPartNameSuggestions();
        triggerPartMatch();
    });
    
    // 点击输入框时显示联想
    partNumInput.addEventListener('focus', () => {
        if (partNumInput.value && partNumInput.value.trim()) {
            showPartNumSuggestions(partNumInput.value);
        }
    });
    
    partNameInput.addEventListener('focus', () => {
        if (partNameInput.value && partNameInput.value.trim()) {
            triggerPartNameSuggestions();
        }
    });
    
    // 点击外部关闭联想
    document.getElementById('add-part-overlay').addEventListener('click', (e) => {
        if (!e.target.closest('.part-number-input-wrapper') && 
            !e.target.closest('.part-name-input-wrapper')) {
            hidePartNumSuggestions();
            hidePartNameSuggestions();
        }
    });
}

// ==================== 拍照识别零件（Brickognize）====================
let recognizeUploading = false;

// 触发相机/相册选择
function recognizePartFromPhoto() {
    if (recognizeUploading) { alert('正在识别中，请稍候...'); return; }
    const input = document.getElementById('recognize-camera-input');
    if (!input) return;
    input.value = ''; // 允许重复选择同一张图片
    input.click();
}

// 处理识别文件上传
async function processRecognitionFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type || file.type.indexOf('image/') !== 0) {
        setRecognizeStatus('请选择图片文件');
        return;
    }
    if (recognizeUploading) return;
    recognizeUploading = true;
    setRecognizeStatus('正在处理图片...');

    try {
        // 压缩图片（缩小尺寸、转 JPEG），避免API因文件太大或格式不支持返回422
        const compressed = await compressImage(file, 1024);
        if (!compressed) { setRecognizeStatus('图片处理失败'); return; }

        // 本地预览压缩后的图片
        const previewUrl = URL.createObjectURL(compressed);
        const box = document.getElementById('recognize-result');
        if (box) box.innerHTML = `<img class="recognize-thumb" src="${previewUrl}" alt="预览图片" />`;

        setRecognizeStatus('正在上传识别中，请稍候...');
        const candidate = await uploadToBrickognize(compressed);
        URL.revokeObjectURL(previewUrl);
        if (!candidate) { setRecognizeStatus('未识别到零件，请重试'); return; }
        await fillRecognizedPart(candidate.id, candidate.name);
        const colors = await computeClosestRBColors(compressed);
        renderRecognizeColors(colors);
    } catch (err) {
        console.error('Brickognize识别失败:', err);
        setRecognizeStatus('识别失败：' + (err && err.message ? err.message : '网络错误，请检查网络'));
    } finally {
        recognizeUploading = false;
    }
}

// 压缩图片：缩放到最长边不超过 maxSize，输出 JPEG
async function compressImage(file, maxSize) {
    const img = await fileToImage(file);
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w <= 0 || h <= 0) return null;
    // 等比例缩放
    if (w > maxSize || h > maxSize) {
        const ratio = Math.min(maxSize / w, maxSize / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            if (!blob) { resolve(null); return; }
            resolve(new File([blob], 'recognize.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.85);
    });
}

// 调用 Brickognize 识别零件型号
async function uploadToBrickognize(file) {
    const formData = new FormData();
    formData.append('query_image', file);
    const url = 'https://api.brickognize.com/predict/parts/?predict_color=false&top_k_items=3&min_similarity_items=0';
    const resp = await fetch(url, { method: 'POST', body: formData });
    if (!resp.ok) {
        // 尝试读取错误详情
        let detail = 'HTTP ' + resp.status;
        try { const errBody = await resp.json(); if (errBody.detail) detail += ' ' + JSON.stringify(errBody.detail); } catch (e) { /* 忽略 */ }
        throw new Error(detail);
    }
    const data = await resp.json();
    const items = (data && data.items) || [];
    if (!items.length) return null;
    // 优先返回零件(part)候选，其次取得分最高的候选
    const cand = items.find(i => i.type === 'part') || items[0];
    return { id: String(cand.id), name: cand.name || '' };
}

// 将识别到的型号/名称填入表单
async function fillRecognizedPart(partNum, fallbackName) {
    const numInput = document.getElementById('new-part-num');
    const nameInput = document.getElementById('new-part-name');
    if (!numInput) return;
    numInput.value = partNum;

    // 名称优先取 RB 数据库，其次用识别结果返回的名称
    let name = fallbackName || '';
    try {
        const p = await getPartByNum(partNum);
        if (p && p.name) name = p.name;
    } catch (e) { /* 忽略 */ }
    if (nameInput) nameInput.value = name;

    // 收拢联想下拉
    const sug = document.getElementById('part-number-suggestions');
    if (sug) sug.style.display = 'none';
}

// 设置识别结果区域的临时状态文本
function setRecognizeStatus(msg) {
    const box = document.getElementById('recognize-result');
    if (!box) return;
    const partNum = document.getElementById('new-part-num').value;
    box.innerHTML = `<div class="recognize-status">${msg}${partNum ? '<br/>已识别型号：<b>' + partNum + '</b>' : ''}</div>`;
}

// 计算图片中零件最接近的5种颜色，按亮度等级匹配（深/较深/正常/较浅/浅）
async function computeClosestRBColors(file) {
    try {
        const img = await fileToImage(file);
        const dominant = getDominantColor(img);
        if (!dominant) return [];
        const rbColors = (await getAllColors()) || [];
        const entries = rbColors.map(c => {
            const rgb = parseHexColor(c.rgb);
            return rgb ? { id: c.id, name: c.name || ('颜色' + c.id), rgb, lab: rgbToLab(rgb) } : null;
        }).filter(Boolean);

        // 计算主色 Lab
        const dominantLab = rgbToLab(dominant);

        // 5 个亮度等级，模拟不同曝光下主色偏移后的候选色
        const levels = [
            { label: '深',   fn: c => c.map(v => Math.round(v * 0.50)) },
            { label: '较深', fn: c => c.map(v => Math.round(v * 0.75)) },
            { label: '正常', fn: c => [...c] },
            { label: '较浅', fn: c => c.map(v => Math.round(v + (255 - v) * 0.25)) },
            { label: '浅',   fn: c => c.map(v => Math.round(v + (255 - v) * 0.50)) },
        ];

        const usedIds = new Set();
        const results = [];
        for (const { label, fn } of levels) {
            const adjusted = fn(dominant);
            const adjustedLab = rgbToLab(adjusted);
            // 找当前亮度下最接近且尚未推荐的 RB 颜色
            const sorted = entries
                .filter(e => !usedIds.has(e.id))
                .sort((a, b) => deltaE76(adjustedLab, a.lab) - deltaE76(adjustedLab, b.lab));
            if (sorted.length) {
                const match = sorted[0];
                usedIds.add(match.id);
                results.push({ id: match.id, name: match.name, hex: rgbToHex(match.rgb), label });
            }
        }
        // 若不足 5 个，补足（用 dominantLab 匹配剩余）
        if (results.length < 5) {
            entries.filter(e => !usedIds.has(e.id))
                .sort((a, b) => deltaE76(dominantLab, a.lab) - deltaE76(dominantLab, b.lab))
                .slice(0, 5 - results.length)
                .forEach(r => { usedIds.add(r.id); results.push({ id: r.id, name: r.name, hex: rgbToHex(r.rgb), label: '' }); });
        }
        return results;
    } catch (e) {
        console.error('计算最接近颜色失败:', e);
        return [];
    }
}

// 渲染推荐颜色卡片，点击即可填入颜色ID
function renderRecognizeColors(colors) {
    const box = document.getElementById('recognize-result');
    if (!box) return;
    const partNum = document.getElementById('new-part-num').value;
    if (colors.length === 0) {
        box.innerHTML = `<div class="recognize-status">已识别型号：<b>${partNum}</b>（未能计算推荐颜色）</div>`;
        return;
    }
    box.innerHTML = `
        <div class="recognize-header">已识别型号：<b>${partNum}</b></div>
        <div class="recognize-section-title">最接近颜色：</div>
        <div class="recognize-colors-row">
            ${colors.map(c => `
                <button type="button" class="recognize-color-chip" data-id="${c.id}" data-name="${c.name}" title="${c.name}">
                    <span class="chip-swatch" style="background:${c.hex}">
                        <span class="chip-label">${c.label}</span>
                    </span>
                    <span class="chip-name">${c.name}</span>
                </button>`).join('')}
        </div>
    `;
    const chips = box.querySelectorAll('.recognize-color-chip');
    chips.forEach((chip, idx) => {
        chip.addEventListener('click', () => selectRecognizeColor(chip, idx));
    });
    // 默认选中第一个（最接近）并填入颜色ID
    if (chips.length) selectRecognizeColor(chips[0], 0);
}

// 选择某个推荐颜色，填入颜色ID并刷新按钮色块
function selectRecognizeColor(chip, idx) {
    const box = document.getElementById('recognize-result');
    const colorInput = document.getElementById('new-part-color');
    if (!colorInput) return;
    colorInput.value = chip.dataset.id;
    updateColorButtonColor(chip.dataset.id);
    if (box) box.querySelectorAll('.recognize-color-chip').forEach(c => c.classList.toggle('selected', c === chip));
}

// 文件转 Image 对象
function fileToImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
        img.src = url;
    });
}

// 提取图片主色：取中心区域60%，排除过亮/过暗的像素（背景/阴影），按颜色分桶取最大桶
function getDominantColor(img) {
    // 取中心 60% 区域，排除边缘背景干扰
    const cw = Math.round(img.naturalWidth * 0.6);
    const ch = Math.round(img.naturalHeight * 0.6);
    const ox = Math.round((img.naturalWidth - cw) / 2);
    const oy = Math.round((img.naturalHeight - ch) / 2);

    const w = 64, h = 64;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, ox, oy, cw, ch, 0, 0, w, h);
    let data;
    try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return null; }

    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // 跳过过亮（背景/白平衡过曝）和过暗（阴影/黑背景）的像素
        if (r + g + b > 720 || r + g + b < 50) continue;
        const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5); // 每通道按 32 量化
        let bk = buckets.get(key);
        if (!bk) { bk = { cnt: 0, rs: 0, gs: 0, bs: 0 }; buckets.set(key, bk); }
        bk.cnt++; bk.rs += r; bk.gs += g; bk.bs += b;
    }
    // 如果所有像素都被过滤，回退到不过滤
    if (buckets.size === 0) {
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
            let bk = buckets.get(key);
            if (!bk) { bk = { cnt: 0, rs: 0, gs: 0, bs: 0 }; buckets.set(key, bk); }
            bk.cnt++; bk.rs += r; bk.gs += g; bk.bs += b;
        }
    }
    let best = null;
    buckets.forEach(bk => { if (!best || bk.cnt > best.cnt) best = bk; });
    if (!best) return null;
    return [Math.round(best.rs / best.cnt), Math.round(best.gs / best.cnt), Math.round(best.bs / best.cnt)];
}

// 解析 RB 颜色 rgb 字符串为 [r,g,b]，兼容带/不带 # 前缀
function parseHexColor(rgb) {
    if (!rgb) return null;
    let s = String(rgb).replace('#', '').trim();
    if (s.length === 3) s = s.split('').map(ch => ch + ch).join('');
    if (s.length !== 6) return null;
    const r = parseInt(s.substr(0, 2), 16), g = parseInt(s.substr(2, 2), 16), b = parseInt(s.substr(4, 2), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
}

// RGB 数组转 #rrggbb
function rgbToHex(rgb) {
    return '#' + rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

// sRGB → CIELAB（D65 标准照明体），用于人眼感知更均匀的色差计算
function rgbToLab(rgb) {
    let r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    // sRGB gamma 解码
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    // Linear RGB → XYZ (D65)
    const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
    const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
    const z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
    // XYZ → Lab (D65)
    const xn = 0.95047, yn = 1.0, zn = 1.08883;
    const fx = x / xn > 0.008856 ? Math.pow(x / xn, 1/3) : 7.787 * (x / xn) + 16/116;
    const fy = y / yn > 0.008856 ? Math.pow(y / yn, 1/3) : 7.787 * (y / yn) + 16/116;
    const fz = z / zn > 0.008856 ? Math.pow(z / zn, 1/3) : 7.787 * (z / zn) + 16/116;
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// CIE76 Delta E：Lab 空间欧氏距离，比 RGB 距离更接近人眼感知
function deltaE76(a, b) {
    const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dl * dl + da * da + db * db);
}

// ==================== 搜索页拍照识别 ====================
let searchRecognizeInput = null;

function recognizePartFromSearch() {
    // 确保隐藏文件输入存在
    if (!searchRecognizeInput) {
        searchRecognizeInput = document.createElement('input');
        searchRecognizeInput.type = 'file';
        searchRecognizeInput.accept = 'image/*';
        searchRecognizeInput.style.display = 'none';
        searchRecognizeInput.addEventListener('change', async () => {
            const file = searchRecognizeInput.files && searchRecognizeInput.files[0];
            if (!file) return;
            searchRecognizeInput.value = '';

            // 复用"添加零件"的识别函数，但识别后填入搜索框并自动搜索
            try {
                const compressed = await compressImage(file, 1024);
                if (!compressed) { alert('图片处理失败'); return; }
                const candidate = await uploadToBrickognize(compressed);
                if (!candidate) { alert('未识别到零件，请重试'); return; }
                document.getElementById('search-part-num').value = candidate.id;
                handleAdvancedSearch();
            } catch (err) {
                console.error('搜索识别失败:', err);
                alert('识别失败：' + (err && err.message ? err.message : '网络错误'));
            }
        });
        document.body.appendChild(searchRecognizeInput);
    }
    searchRecognizeInput.click();
}

function togglePartNewStatus(isNew) {
    window.newPartIsNew = isNew;
    document.getElementById('status-new').classList.toggle('active', isNew);
    document.getElementById('status-used').classList.toggle('active', !isNew);
}

async function saveNewPart(button) {
    const partNum = document.getElementById('new-part-num').value;
    const partName = document.getElementById('new-part-name').value;
    const colorInput = document.getElementById('new-part-color').value;
    const quantity = parseInt(document.getElementById('new-part-quantity').value);
    
    if (!partNum) {
        document.getElementById('add-part-error').textContent = '请输入零件型号';
        document.getElementById('add-part-error').style.display = 'block';
        return;
    }
    
    if (!colorInput) {
        document.getElementById('add-part-error').textContent = '请输入颜色ID';
        document.getElementById('add-part-error').style.display = 'block';
        return;
    }
    
    if (isNaN(quantity) || quantity <= 0) {
        document.getElementById('add-part-error').textContent = '请输入有效的数量';
        document.getElementById('add-part-error').style.display = 'block';
        return;
    }
    
    const newPartData = {
        box_id: selectedBox.id,
        part_num: partNum,
        name: partName || partNum,
        color_id: parseInt(colorInput),
        quantity: quantity,
        is_new: window.newPartIsNew
    };

    // 检查是否存在重复零件（型号、颜色、状态一致）
    const existingParts = await getParts(selectedBox.id);
    const duplicateParts = existingParts.filter(p =>
        p.part_num === newPartData.part_num &&
        p.color_id === newPartData.color_id &&
        Boolean(p.is_new) === Boolean(newPartData.is_new)
    );

    if (duplicateParts.length > 0) {
        // 创建对话框
        const confirmOverlay = document.createElement('div');
        confirmOverlay.className = 'modal-overlay active';
        confirmOverlay.id = 'duplicate-part-overlay';

        const confirmSheet = document.createElement('div');
        confirmSheet.className = 'modal-content add-part-modal';

        // 生成重复零件卡片的 HTML
        let partsCardsHtml = '';
        for (let i = 0; i < duplicateParts.length; i++) {
            const part = duplicateParts[i];
            const imgUrl = await getPartImageUrl(part.part_num, part.color_id);
            const isSelected = i === 0; // 默认选中第一个
            partsCardsHtml += `
                <div class="dup-part-card ${isSelected ? 'selected' : ''}" data-part-id="${part.id}">
                    <div class="dup-part-left">
                        <div class="dup-part-image">
                            ${imgUrl ? `<img src="${imgUrl}" alt="${part.part_num}">` : ''}
                        </div>
                    </div>
                    <div class="dup-part-right">
                        <div class="dup-part-num">${part.part_num}</div>
                        <div class="dup-part-color">C: ${part.color_id}</div>
                        <div class="dup-part-status ${part.is_new ? 'new' : 'used'}">
                            ${part.is_new ? '新' : '旧'}
                        </div>
                        <div class="dup-part-quantity"><span class="dup-part-x">x</span>${part.quantity}</div>
                    </div>
                </div>
            `;
        }

        confirmSheet.innerHTML = `
            <div class="modal-header">
                <span class="modal-title">检测到重复零件</span>
                <button class="btn-cancel" id="dup-cancel-btn">取消</button>
            </div>
            <div class="modal-body" style="padding: 0;">
                <div style="padding: 20px 16px 12px;">
                    <div style="font-size: 16px; color: #333; margin-bottom: 12px; text-align: center;">
                        选择要合并的零件
                    </div>
                </div>
                <div class="dup-parts-scroll">
                    ${partsCardsHtml}
                </div>
                <div style="padding: 0 16px 20px;">
                    <div style="font-size: 14px; color: #666; margin-bottom: 16px; text-align: center;">
                        您刚刚输入了 <strong style="color: #333;">${quantity}</strong> 个
                    </div>
                    <div style="display: flex; gap: 12px; justify-content: center;">
                        <button id="dup-merge-btn" class="btn-save" style="flex: 1; background-color: #27ae60;">合并到选中</button>
                        <button id="dup-new-btn" class="btn-cancel" style="flex: 1; background-color: #3498db; color: white; border: none;">新增</button>
                    </div>
                </div>
            </div>
        `;

        confirmOverlay.appendChild(confirmSheet);
        document.body.appendChild(confirmOverlay);

        let selectedPartId = duplicateParts[0].id;

        // 绑定卡片选择事件
        const partCards = confirmSheet.querySelectorAll('.dup-part-card');
        partCards.forEach(card => {
            card.addEventListener('click', () => {
                partCards.forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                selectedPartId = parseInt(card.dataset.partId);
            });
        });

        // 绑定取消按钮事件
        document.getElementById('dup-cancel-btn').addEventListener('click', () => {
            confirmOverlay.remove();
        });

        // 绑定合并按钮事件
        document.getElementById('dup-merge-btn').addEventListener('click', async () => {
            const selectedPart = duplicateParts.find(p => p.id === selectedPartId);
            if (!selectedPart) {
                alert('请选择要合并的零件');
                return;
            }
            const newQty = selectedPart.quantity + newPartData.quantity;
            const success = await updatePart(selectedPart.id, { quantity: newQty });
            if (success) {
                confirmOverlay.remove();
                button.closest('.modal-overlay').remove();
                if (selectedBox) {
                    await loadParts(selectedBox.id);
                }
            } else {
                alert('合并失败，请重试');
            }
        });

        // 绑定新增按钮事件
        document.getElementById('dup-new-btn').addEventListener('click', async () => {
            confirmOverlay.remove();
            const newPart = await createPart(newPartData);
            if (newPart) {
                button.closest('.modal-overlay').remove();
                if (selectedBox) {
                    await loadParts(selectedBox.id);
                }
            }
        });

        return; // 提前返回，不再执行后续的默认创建逻辑
    }

    // 无重复，直接创建新零件
    const newPart = await createPart(newPartData);
    
    if (newPart) {
        button.closest('.modal-overlay').remove();
        if (selectedBox) {
            await loadParts(selectedBox.id);
        }
    }
}

// 称重计算：弹出窗口输入总重量，根据零件型号从 Bricklink 查询单个零件重量后计算数量
function showWeightCalculator() {
    const partNumInput = document.getElementById('new-part-num');
    const partNum = partNumInput ? partNumInput.value.trim() : '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'weight-calc-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content weight-calc-modal';

    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">称重计算</span>
            <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">取消</button>
        </div>
        <div class="modal-body">
            <div class="form-row">
                <label class="form-label">零件型号：</label>
                <input type="text" id="weight-calc-part-num" class="form-input" value="${partNum}" placeholder="请输入零件型号" />
                <button class="btn-secondary" id="weight-calc-fetch-btn" onclick="fetchPartWeightForCalculator()" style="padding: 8px 10px; font-size: 12px; white-space: nowrap;">获取重量</button>
            </div>
            <div class="form-row">
                <label class="form-label">单个重量：</label>
                <input type="text" id="weight-calc-unit-weight" class="form-input" placeholder="点击"获取重量"自动填入（克）" readonly />
            </div>
            <div class="form-row">
                <label class="form-label">总重量(克)：</label>
                <input type="number" id="weight-calc-total-weight" class="form-input" placeholder="请输入称重总重量（克）" step="0.01" />
            </div>
            <div class="form-row status-save-row">
                <div id="weight-calc-message" style="flex:1; font-size:12px; color:#27ae60;"></div>
                <button class="btn-save" onclick="calculateWeightQuantity()">计算并填入数量</button>
            </div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // 回车触发计算
    document.getElementById('weight-calc-total-weight').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            calculateWeightQuantity();
        }
    });
}

// 从 Bricklink 查询零件重量（通过 CORS 代理，无需后端）
async function fetchPartWeightForCalculator() {
    const partNumInput = document.getElementById('weight-calc-part-num');
    const unitWeightInput = document.getElementById('weight-calc-unit-weight');
    const messageEl = document.getElementById('weight-calc-message');
    const fetchBtn = document.getElementById('weight-calc-fetch-btn');

    if (!partNumInput) return;

    const partNum = partNumInput.value.trim();
    if (!partNum) {
        if (messageEl) {
            messageEl.style.color = '#e74c3c';
            messageEl.textContent = '请输入零件型号';
        }
        return;
    }

    const cleanPartNum = partNum.replace(/[^a-zA-Z0-9]/g, '');
    if (!cleanPartNum) {
        if (messageEl) {
            messageEl.style.color = '#e74c3c';
            messageEl.textContent = '零件型号无效';
        }
        return;
    }

    if (messageEl) {
        messageEl.style.color = '#7f8c8d';
        messageEl.textContent = `正在查询 ${cleanPartNum} 的重量...`;
    }
    if (unitWeightInput) {
        unitWeightInput.value = '';
        unitWeightInput.placeholder = '查询中...';
    }
    if (fetchBtn) {
        fetchBtn.disabled = true;
        fetchBtn.textContent = '查询中...';
    }

    try {
        const data = await fetchBricklinkPartWeight(cleanPartNum);

        if (data.weight !== null && data.weight !== undefined && data.weight > 0) {
            if (unitWeightInput) {
                unitWeightInput.value = data.weight;
                unitWeightInput.placeholder = '克';
            }
            if (messageEl) {
                messageEl.style.color = '#27ae60';
                const sourceLabel = data.source === 'offline' ? '离线' : (data.source === 'supabase' ? '缓存' : '在线');
                messageEl.textContent = `获取成功（${sourceLabel}）：${cleanPartNum} = ${data.weight}g`;
            }
        } else {
            if (messageEl) {
                messageEl.style.color = '#e74c3c';
                messageEl.textContent = data.error || `未找到 ${cleanPartNum} 的重量数据，可手动输入单个重量后计算`;
            }
            if (unitWeightInput) {
                unitWeightInput.readOnly = false;
                unitWeightInput.placeholder = '获取失败，可手动输入（克）';
            }
        }
    } catch (error) {
        if (messageEl) {
            messageEl.style.color = '#e74c3c';
            messageEl.textContent = `查询失败：${error.message}，可手动输入单个重量后计算`;
        }
        if (unitWeightInput) {
            unitWeightInput.readOnly = false;
            unitWeightInput.placeholder = '获取失败，可手动输入（克）';
        }
    } finally {
        if (fetchBtn) {
            fetchBtn.disabled = false;
            fetchBtn.textContent = '获取重量';
        }
    }
}

// 根据总重量和单个重量计算数量，并填入添加零件页面的数量输入框
function calculateWeightQuantity() {
    const unitWeightInput = document.getElementById('weight-calc-unit-weight');
    const totalWeightInput = document.getElementById('weight-calc-total-weight');
    const messageEl = document.getElementById('weight-calc-message');

    const unitWeight = parseFloat(unitWeightInput ? unitWeightInput.value : '');
    const totalWeight = parseFloat(totalWeightInput ? totalWeightInput.value : '');

    if (isNaN(totalWeight) || totalWeight <= 0) {
        if (messageEl) {
            messageEl.style.color = '#e74c3c';
            messageEl.textContent = '请输入有效的总重量';
        }
        return;
    }

    if (isNaN(unitWeight) || unitWeight <= 0) {
        if (messageEl) {
            messageEl.style.color = '#e74c3c';
            messageEl.textContent = '请先获取或输入单个零件重量';
        }
        return;
    }

    const quantity = Math.round(totalWeight / unitWeight);
    const finalQuantity = Math.max(1, quantity);

    // 填入添加零件页面的数量输入框
    const quantityInput = document.getElementById('new-part-quantity');
    if (quantityInput) {
        quantityInput.value = finalQuantity;
        // 触发 change 事件以便其他逻辑感知
        quantityInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (messageEl) {
        messageEl.style.color = '#27ae60';
        messageEl.textContent = `计算完成：${totalWeight}g ÷ ${unitWeight}g = ${finalQuantity} 个`;
    }

    // 1.2 秒后关闭弹窗
    setTimeout(() => {
        const overlay = document.getElementById('weight-calc-overlay');
        if (overlay) overlay.remove();
    }, 1200);
}

function showPartSelector() {
    if (!selectedBox) {
        alert('请先选择一个盒子');
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content part-selector-modal';

    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">选择零件</span>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="part-search-bar">
                <input type="text" id="part-search-input" placeholder="搜索零件型号或名称..." />
            </div>
            <div class="part-suggestions" id="part-suggestions"></div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    document.getElementById('part-search-input').addEventListener('input', function(e) {
        handlePartSearch(e.target.value);
    });

    document.getElementById('part-search-input').focus();
    handlePartSearch('');
}

async function handlePartSearch(query) {
    const suggestions = await getPartSuggestions(query);
    const container = document.getElementById('part-suggestions');
    container.innerHTML = '';

    if (suggestions.length === 0) {
        container.innerHTML = '<div class="no-suggestions">未找到匹配的零件</div>';
        return;
    }

    suggestions.forEach(part => {
        const item = document.createElement('div');
        item.className = 'part-suggestion-item';

        item.innerHTML = `
            <div class="part-suggestion-num">${part.part_num}</div>
            <div class="part-suggestion-name">${part.name}</div>
        `;

        item.addEventListener('click', () => {
            document.getElementById('new-part-num').value = part.part_num;
            document.getElementById('new-part-name').value = part.name;
            document.querySelector('.modal-overlay.active').remove();
        });

        container.appendChild(item);
    });
}

function showColorPicker() {
    if (!selectedBox) {
        alert('请先选择一个盒子');
        return;
    }

    const partNum = document.getElementById('new-part-num').value.trim();
    if (!partNum) {
        alert('请先输入零件型号');
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content color-picker-modal';

    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">选择颜色 (${partNum})</span>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="color-search-bar">
                <input type="text" id="color-search-input" placeholder="搜索颜色名称或ID..." />
            </div>
            <div class="color-grid" id="color-grid">
                <div style="text-align: center; padding: 20px; color: #999; grid-column: 1 / -1;">加载颜色中...</div>
            </div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    loadColorGrid(partNum);

    document.getElementById('color-search-input').addEventListener('input', function(e) {
        filterColors(e.target.value);
    });
}

async function loadColorGrid(partNum) {
    const grid = document.getElementById('color-grid');

    // 从RB数据库查询该零件的所有颜色
    const partColors = await getPartColors(partNum);

    if (!partColors || partColors.length === 0) {
        grid.innerHTML = '<div style="text-align: center; padding: 20px; color: #999; grid-column: 1 / -1;">该零件在RB数据库中未找到颜色记录<br>请直接输入颜色ID</div>';
        return;
    }

    // 获取每个颜色的详细信息（从colors表）
    const colorIds = [...new Set(partColors.map(pc => pc.color_id))];
    const colors = [];
    for (const colorId of colorIds) {
        const colorInfo = await getColorById(colorId);
        if (colorInfo) {
            colors.push(colorInfo);
        }
    }

    if (colors.length === 0) {
        grid.innerHTML = '<div style="text-align: center; padding: 20px; color: #999; grid-column: 1 / -1;">未找到颜色信息</div>';
        return;
    }

    grid.innerHTML = '';

    colors.forEach(color => {
        const colorCard = document.createElement('div');
        colorCard.className = 'color-card';
        colorCard.dataset.id = color.id;

        // 确保rgb值有#前缀
        const rgbValue = color.rgb && color.rgb.startsWith('#') ? color.rgb : '#' + (color.rgb || 'FFFFFF');
        colorCard.style.backgroundColor = rgbValue;

        // 计算文字颜色（基于背景亮度）
        const hex = rgbValue.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        const textColor = brightness > 128 ? '#000' : '#fff';

        colorCard.innerHTML = `
            <div class="color-card-id" style="color: ${textColor}">${color.id}</div>
            <div class="color-card-name" style="color: ${textColor}">${color.name}</div>
        `;

        colorCard.addEventListener('click', (e) => {
            const colorInput = document.getElementById('new-part-color');
            if (colorInput) {
                colorInput.value = color.id;
                updateColorButtonColor(color.id);
            }
            e.target.closest('.modal-overlay').remove();
        });

        grid.appendChild(colorCard);
    });
}

function filterColors(searchText) {
    const cards = document.querySelectorAll('.color-card');
    cards.forEach(card => {
        const name = card.querySelector('.color-card-name').textContent.toLowerCase();
        const id = card.querySelector('.color-card-id').textContent;
        const match = name.includes(searchText.toLowerCase()) || id.includes(searchText);
        card.style.display = match ? 'flex' : 'none';
    });
}

// 更新颜色选择按钮的底色
async function updateColorButtonColor(colorId) {
    const btn = document.getElementById('color-pick-btn');
    if (!btn) return;
    
    // 转为字符串处理
    const idStr = String(colorId || '').trim();
    
    // 如果没有颜色ID或颜色ID为空，恢复默认浅灰色
    if (!idStr) {
        btn.style.backgroundColor = '';
        btn.classList.remove('color-white');
        return;
    }
    
    try {
        // 转为数字供 IndexedDB 查询（数据库中颜色ID为数字键）
        const idNum = Number(idStr);
        const colorInfo = await getColorById(idNum);
        
        if (colorInfo && colorInfo.rgb) {
            // 获取RGB值，确保有#前缀
            const rgbValue = colorInfo.rgb.startsWith('#') ? colorInfo.rgb : '#' + colorInfo.rgb;
            
            // 设置按钮背景色
            btn.style.backgroundColor = rgbValue;
            
            // 计算亮度，判断文字颜色
            const hex = rgbValue.replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            
            // 如果是白色或浅色，文字用黑色
            if (brightness > 200) {
                btn.classList.add('color-white');
            } else {
                btn.classList.remove('color-white');
            }
        } else {
            // 找不到颜色ID对应的颜色，恢复默认浅灰色
            btn.style.backgroundColor = '';
            btn.classList.remove('color-white');
        }
    } catch (error) {
        console.error('更新颜色按钮失败:', error);
        btn.style.backgroundColor = '';
        btn.classList.remove('color-white');
    }
}



// 搜索页颜色选择器（参照添加零件的颜色选择方法）
function showSearchColorPicker() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content color-picker-modal';

    const partNum = document.getElementById('search-part-num').value.trim();
    const title = partNum ? `选择颜色 (${partNum})` : '选择颜色';

    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">${title}</span>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="color-search-bar">
                <input type="text" id="color-search-input" placeholder="搜索颜色名称或ID..." />
            </div>
            <div class="color-grid" id="color-grid">
                <div style="text-align: center; padding: 20px; color: #999; grid-column: 1 / -1;">加载颜色中...</div>
            </div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    loadSearchColorGrid(partNum);

    document.getElementById('color-search-input').addEventListener('input', function(e) {
        filterColors(e.target.value);
    });
}

async function loadSearchColorGrid(partNum) {
    const grid = document.getElementById('color-grid');
    let colors = [];

    // 若有型号，先按零件可用颜色加载
    if (partNum) {
        const partColors = await getPartColors(partNum);
        if (partColors && partColors.length > 0) {
            const colorIds = [...new Set(partColors.map(pc => pc.color_id))];
            for (const colorId of colorIds) {
                const colorInfo = await getColorById(colorId);
                if (colorInfo) colors.push(colorInfo);
            }
        }
    }

    // 若无型号或该型号无颜色记录，加载全部颜色
    if (colors.length === 0) {
        colors = await getAllColors();
    }

    if (!colors || colors.length === 0) {
        grid.innerHTML = '<div style="text-align: center; padding: 20px; color: #999; grid-column: 1 / -1;">未找到颜色信息<br>请直接输入颜色ID</div>';
        return;
    }

    grid.innerHTML = '';

    colors.forEach(color => {
        const colorCard = document.createElement('div');
        colorCard.className = 'color-card';
        colorCard.dataset.id = color.id;

        const rgbValue = color.rgb && color.rgb.startsWith('#') ? color.rgb : '#' + (color.rgb || 'FFFFFF');
        colorCard.style.backgroundColor = rgbValue;

        const hex = rgbValue.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        const textColor = brightness > 128 ? '#000' : '#fff';

        colorCard.innerHTML = `
            <div class="color-card-id" style="color: ${textColor}">${color.id}</div>
            <div class="color-card-name" style="color: ${textColor}">${color.name}</div>
        `;

        colorCard.addEventListener('click', (e) => {
            document.getElementById('search-color-id').value = color.id;
            updateColorPickButton(color.id);
            e.target.closest('.modal-overlay').remove();
        });

        grid.appendChild(colorCard);
    });
}

async function handleAdvancedSearch() {
    const params = {
        part_num: document.getElementById('search-part-num').value,
        name: document.getElementById('search-part-name').value,
        color_id: document.getElementById('search-color-id').value,
        is_new: document.getElementById('search-status').value === '' ? undefined : 
               document.getElementById('search-status').value === 'true'
    };
    
    const parts = await advancedSearchParts(params);
    renderSearchResults(parts);
}

// 更新选色按钮样式：根据颜色ID设置底色和文字颜色
async function updateColorPickButton(colorId) {
    const btn = document.querySelector('.btn-color-pick');
    if (!btn) return;

    if (!colorId) {
        // 恢复默认样式
        btn.style.backgroundColor = '';
        btn.style.color = '';
        btn.style.borderColor = '';
        btn.textContent = '选色';
        return;
    }

    const colorInfo = await getColorById(colorId);
    if (!colorInfo) return;

    const rgbValue = colorInfo.rgb && colorInfo.rgb.startsWith('#') ? colorInfo.rgb : '#' + (colorInfo.rgb || 'FFFFFF');
    btn.style.backgroundColor = rgbValue;
    btn.style.borderColor = rgbValue;

    // 计算亮度决定文字颜色
    const hex = rgbValue.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    btn.style.color = brightness > 128 ? '#000' : '#fff';
    btn.textContent = colorInfo.name || '选色';
}

function resetSearchFilters() {
    document.getElementById('search-part-num').value = '';
    document.getElementById('search-part-name').value = '';
    document.getElementById('search-color-id').value = '';
    document.getElementById('search-status').value = '';
    document.getElementById('search-results').innerHTML = '';
    updateColorPickButton('');
}

async function renderSearchResults(parts) {
    const results = document.getElementById('search-results');
    results.innerHTML = '';

    if (parts.length === 0) {
        results.innerHTML = '<div class="no-search-results"><p>没有找到匹配的零件</p></div>';
        return;
    }

    // 一次性获取所有盒子、仓库、颜色信息，构建查找映射
    const [boxes, repos, colors] = await Promise.all([
        getBoxes(null),
        getRepositories(),
        getAllColors()
    ]);

    const boxMap = {};
    (boxes || []).forEach(b => { boxMap[b.id] = b; });
    const repoMap = {};
    (repos || []).forEach(r => { repoMap[r.id] = r; });
    const colorMap = {};
    (colors || []).forEach(c => { colorMap[c.id] = c; });

    parts.forEach(part => {
        const card = document.createElement('div');
        card.className = 'search-result-card';
        card.dataset.partId = part.id;

        const color = colorMap[part.color_id];
        const colorName = color ? color.name : '未知颜色';

        // 仓库与盒子名称
        const box = boxMap[part.box_id];
        const repo = box ? repoMap[box.repository_id] : null;
        const repoName = repo ? repo.name : '未知仓库';
        const boxName = box ? box.name : '未知盒子';

        // 数量颜色：少于10红色，10-50橙色，50以上绿色
        const qty = part.quantity;
        let qtyClass = 'qty-red';
        if (qty >= 50) qtyClass = 'qty-green';
        else if (qty >= 10) qtyClass = 'qty-orange';

        card.innerHTML = `
            <div class="src-left">
                <div class="src-image">
                    <div class="src-img-loading">加载中...</div>
                </div>
                <div class="src-part-num">${part.part_num}</div>
            </div>
            <div class="src-right">
                <div class="src-row src-row1">
                    <span class="src-label">名称：</span>
                    <span class="src-name" title="${part.name || ''}">${part.name || ''}</span>
                </div>
                <div class="src-row src-row2">
                    <span class="src-label">颜色：</span>
                    <span class="src-color-name" title="${colorName}">${colorName}</span>
                    <span class="src-status ${part.is_new ? 'new' : 'used'}" title="${part.is_new ? '新品' : '旧品'}">${part.is_new ? '新' : '旧'}</span>
                </div>
                <div class="src-row src-row3">
                    <span class="src-label">仓库：</span><span class="src-repo">${repoName}</span>
                </div>
                <div class="src-row src-row4">
                    <span class="src-label">盒子：</span><span class="src-box">${boxName}</span>
                    <span class="src-qty-wrap">
                        <span class="src-label">数量：</span><span class="src-qty ${qtyClass}">${qty}</span>
                    </span>
                </div>
            </div>
        `;

        // 异步加载图片
        getPartImageUrl(part.part_num, part.color_id).then(imgUrl => {
            const imageContainer = card.querySelector('.src-image');
            if (imgUrl) {
                imageContainer.innerHTML = `<img src="${imgUrl}" alt="${part.name || ''}" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=src-no-image>暂无</div>'">`;
            } else {
                imageContainer.innerHTML = '<div class="src-no-image">暂无</div>';
            }
        });

        card.addEventListener('click', () => {
            showPartDetail(part);
        });

        results.appendChild(card);
    });
}

function clearSearchResults() {
    document.getElementById('search-part-num').value = '';
    document.getElementById('search-part-name').value = '';
    document.getElementById('search-color-id').value = '';
    document.getElementById('search-status').value = '';
    document.getElementById('search-results').innerHTML = '';
    updateColorPickButton('');
}

async function showPartDetail(part) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content part-detail-modal';

    // 从RB数据库获取零件名称
    let rbName = part.name || '';
    try {
        const rbPart = await getPartByNum(part.part_num);
        if (rbPart && rbPart.name) {
            rbName = rbPart.name;
        }
    } catch (e) {
        console.warn('获取RB零件名称失败:', e);
    }

    // 从RB数据库获取颜色名称（回退到本地颜色）
    let rbColorName = '未知颜色';
    try {
        const rbColor = await getColorById(part.color_id);
        if (rbColor && rbColor.name) {
            rbColorName = rbColor.name;
        } else {
            const colorInfo = await getColorInfo(part.color_id);
            if (colorInfo && colorInfo.name) {
                rbColorName = colorInfo.name;
            }
        }
    } catch (e) {
        console.warn('获取RB颜色名称失败:', e);
    }

    // 从RB数据库获取图片URL
    let imgUrl = null;
    let hasCustomImage = false;
    try {
        imgUrl = await getPartImageUrl(part.part_num, part.color_id);
        hasCustomImage = !!(await getPartImageFromOfflineCache(part.part_num, part.color_id));
    } catch (e) {
        console.warn('获取RB图片URL失败:', e);
    }

    // 数量颜色：少于10红色，10-50橙色，50以上绿色
    const qty = part.quantity;
    let qtyColorClass = 'qty-red';
    if (qty >= 50) {
        qtyColorClass = 'qty-green';
    } else if (qty >= 10) {
        qtyColorClass = 'qty-orange';
    }

    const isNew = part.is_new;
    const safePartName = (rbName || '').replace(/'/g, "\\'");

    // 构建图片区域
    let imageHtml;
    if (imgUrl) {
        imageHtml = `<img src="${imgUrl}" alt="${rbName}" class="pd-image" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=pd-no-image>加载失败</div>'">`;
    } else {
        imageHtml = `<div class="pd-no-image">暂无图片</div>`;
    }

    // 图片变更按钮文本
    const imgBtnText = imgUrl ? (hasCustomImage ? '管理图片' : '变更图片') : '添加图片';

    sheet.innerHTML = `
        <div class="pd-row pd-title-row">
            <span class="pd-title">零件详情</span>
            <div class="pd-title-btns">
                <button class="pd-del-btn" id="pd-del-btn" data-part-id="${part.id}">删</button>
                <button class="pd-merge-btn" id="pd-merge-btn" data-part-id="${part.id}">并</button>
                <button class="pd-close-btn" onclick="this.closest('.modal-overlay').remove()">返</button>
            </div>
        </div>
        <div class="pd-row pd-image-row" id="pd-image-swipe">
            <div class="pd-image-content">
                ${imageHtml}
            </div>
            <div class="pd-image-action">
                <button class="pd-img-del-btn" onclick="deletePartDetailImage('${part.part_num}', ${part.color_id})">删除图片</button>
                <button class="pd-img-change-btn" onclick="changePartImage('${part.part_num}', ${part.color_id})">${imgBtnText}</button>
                <button class="pd-img-url-btn" onclick="showPartImageUrl('${part.part_num}', ${part.color_id})">图片URL</button>
            </div>
        </div>
        <div class="pd-row pd-model-row">
            <span class="pd-left">型号：<span class="pd-model">${part.part_num}</span></span>
            <span class="pd-status ${isNew ? 'pd-status-new' : 'pd-status-used'}">${isNew ? '新' : '旧'}</span>
        </div>
        <div class="pd-row pd-name-row">
            <span class="pd-label">名称：</span>
            <span class="pd-scroll">${rbName}</span>
        </div>
        <div class="pd-row pd-color-row">
            <div class="pd-color-left">
                <span class="pd-label">颜色：</span>
                <span class="pd-color-id">${part.color_id}</span>
                <span class="pd-scroll pd-color-name">${rbColorName}</span>
            </div>
            <div class="pd-qty">
                <span class="pd-label">数量：</span>
                <span class="pd-qty-val ${qtyColorClass}" id="pd-qty-val">${qty}</span>
            </div>
        </div>
        <div class="pd-row pd-actions">
            <div class="pd-actions-left">
                <button class="pd-btn pd-btn-search" onclick="searchFromDetail('${part.part_num}', ${part.color_id}, '${safePartName}')">搜索</button>
                <button class="pd-btn pd-btn-save" id="pd-save-btn" data-part-id="${part.id}">保存</button>
            </div>
            <div class="pd-actions-right">
                <button class="pd-circle-btn pd-minus-btn" id="pd-minus-btn">−</button>
                <button class="pd-circle-btn pd-plus-btn" id="pd-plus-btn">+</button>
            </div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // 初始化数量调整
    let currentQty = qty;
    const qtyEl = sheet.querySelector('#pd-qty-val');
    const saveBtn = sheet.querySelector('#pd-save-btn');
    const partId = part.id;

    function updateQtyDisplay() {
        qtyEl.textContent = currentQty;
        qtyEl.classList.remove('qty-red', 'qty-orange', 'qty-green');
        let cls = 'qty-red';
        if (currentQty >= 50) cls = 'qty-green';
        else if (currentQty >= 10) cls = 'qty-orange';
        qtyEl.classList.add(cls);
    }

    sheet.querySelector('#pd-minus-btn').addEventListener('click', () => {
        currentQty = Math.max(0, currentQty - 1);
        updateQtyDisplay();
    });

    sheet.querySelector('#pd-plus-btn').addEventListener('click', () => {
        currentQty = currentQty + 1;
        updateQtyDisplay();
    });

    // 保存按钮
    saveBtn.addEventListener('click', async () => {
        const success = await updatePart(partId, { quantity: currentQty });
        if (success) {
            overlay.remove();
            if (selectedBox) {
                await loadParts(selectedBox.id);
            }
            updateSearchResultQuantity(partId, currentQty);
        } else {
            alert('保存失败');
        }
    });

    // 删除按钮长按2秒
    const delBtn = sheet.querySelector('#pd-del-btn');
    let delTimer = null;
    const startDelLongPress = (e) => {
        e.preventDefault();
        delTimer = setTimeout(() => {
            deletePartConfirm(partId);
        }, 2000);
    };
    const cancelDelLongPress = () => {
        if (delTimer) {
            clearTimeout(delTimer);
            delTimer = null;
        }
    };
    delBtn.addEventListener('mousedown', startDelLongPress);
    delBtn.addEventListener('mouseup', cancelDelLongPress);
    delBtn.addEventListener('mouseleave', cancelDelLongPress);
    delBtn.addEventListener('touchstart', startDelLongPress, { passive: false });
    delBtn.addEventListener('touchend', cancelDelLongPress);

    // 图片左滑显示变更按钮
    const imageSwipe = sheet.querySelector('#pd-image-swipe');
    const imageContent = imageSwipe.querySelector('.pd-image-content');
    const imageAction = imageSwipe.querySelector('.pd-image-action');
    const actionWidth = 90;
    let startX = 0, currentX = 0, isSwiping = false, isOpen = false;

    imageContent.style.transition = 'transform 0.25s ease';
    imageAction.style.transition = 'transform 0.25s ease';

    imageSwipe.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isSwiping = true;
        imageContent.style.transition = 'none';
        imageAction.style.transition = 'none';
    }, { passive: true });

    imageSwipe.addEventListener('touchmove', (e) => {
        if (!isSwiping) return;
        const dx = e.touches[0].clientX - startX;
        let baseX = isOpen ? -actionWidth : 0;
        currentX = Math.max(-actionWidth, Math.min(0, baseX + dx));
        imageContent.style.transform = `translateX(${currentX}px)`;
        imageAction.style.transform = `translateX(${currentX + actionWidth}px)`;
    }, { passive: true });

    imageSwipe.addEventListener('touchend', () => {
        if (!isSwiping) return;
        isSwiping = false;
        imageContent.style.transition = 'transform 0.25s ease';
        imageAction.style.transition = 'transform 0.25s ease';
        if (currentX < -actionWidth / 2) {
            isOpen = true;
            imageContent.style.transform = `translateX(-${actionWidth}px)`;
            imageAction.style.transform = `translateX(0)`;
        } else {
            isOpen = false;
            imageContent.style.transform = 'translateX(0)';
            imageAction.style.transform = `translateX(${actionWidth}px)`;
        }
    }, { passive: true });

    // 初始化变更按钮位置（隐藏在右侧）
    imageAction.style.transform = `translateX(${actionWidth}px)`;

    // 合并按钮点击事件
    const mergeBtn = sheet.querySelector('#pd-merge-btn');
    mergeBtn.addEventListener('click', () => {
        showMergePartSelector(part);
    });
}

// 图片变更入口（根据是否有离线缓存图片选择不同操作）
async function changePartImage(partNum, colorId) {
    const hasCustom = !!(await getPartImageFromOfflineCache(partNum, colorId));
    if (hasCustom) {
        manageCustomImage(partNum, colorId);
    } else {
        addCustomImage(partNum, colorId);
    }
}

// 删除零件详情图片（左滑操作区按钮：删离线缓存 + 删Gitee + 详情显示暂无图片）
async function deletePartDetailImage(partNum, colorId) {
    if (!confirm('确定要删除该图片吗？')) return;
    // 删除浏览器离线缓存
    await deletePartImageFromOfflineCache(partNum, colorId);
    // 删除 Gitee Parts-img 仓库图片
    const giteeResult = await deletePartImageFromGitee(partNum, colorId);
    // 清除 RB 数据库中的 img_url，避免 getPartImageUrl 回退到旧图
    await clearPartImageUrlInRB(partNum, colorId);
    // 关闭左滑并更新当前详情：图片区显示"暂无图片"，按钮恢复为"添加图片"
    const sheet = document.querySelector('.part-detail-modal');
    if (sheet) {
        const imageContent = sheet.querySelector('.pd-image-content');
        if (imageContent) imageContent.innerHTML = '<div class="pd-no-image">暂无图片</div>';
        const changeBtn = sheet.querySelector('.pd-img-change-btn');
        if (changeBtn) changeBtn.textContent = '添加图片';
        const imageSwipe = sheet.querySelector('#pd-image-swipe');
        if (imageSwipe) {
            const content = imageSwipe.querySelector('.pd-image-content');
            const action = imageSwipe.querySelector('.pd-image-action');
            if (content) content.style.transform = 'translateX(0)';
            if (action) action.style.transform = 'translateX(90px)';
        }
    }
    if (giteeResult && giteeResult.success === false && giteeResult.error && giteeResult.error !== '文件不存在，无需删除') {
        showToast('图片已删除，但云端(Gitee)删除失败，刷新后可能仍显示');
    } else {
        showToast('图片已删除');
    }
}

// 显示零件图片三级URL（①离线缓存区 ②Gitee ③RB数据库）
async function showPartImageUrl(partNum, colorId) {
    const giteeUrl = buildPartsImgUrl(partNum, colorId);
    let cached = false, giteeOk = false, rbUrls = [];
    try {
        [cached, giteeOk, rbUrls] = await Promise.all([
            getPartImageFromOfflineCache(partNum, colorId).then(r => !!r),
            checkPartsImgOnGitee(partNum, colorId),
            getRBPartImageUrls(partNum, colorId)
        ]);
    } catch (e) {
        console.warn('获取零件图片URL失败:', e);
    }
    const rbUrl = rbUrls.length ? rbUrls[0] : null;
    // 当前生效URL（与详情页 getPartImageUrl 三级读取顺序一致）
    const activeUrl = cached ? giteeUrl : (giteeOk ? giteeUrl : rbUrl);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content';
    sheet.style.maxWidth = '350px';

    const row = (label, status, ok, url) => `
        <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <span style="font-size:13px;font-weight:600;color:#333;">${label}</span>
                <span style="font-size:12px;padding:2px 8px;border-radius:10px;${ok ? 'background:#E8F5E9;color:#2E7D32;' : 'background:#F5F5F5;color:#999;'}">${status}</span>
            </div>
            <div style="word-break:break-all;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;padding:8px;font-size:12px;color:#555;">${url}</div>
        </div>`;

    sheet.innerHTML = `
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span class="modal-title" style="font-size:16px;font-weight:600;">零件图片URL</span>
            <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()" style="background:#f44336;color:white;padding:6px 14px;font-size:13px;border:none;border-radius:4px;cursor:pointer;">关闭</button>
        </div>
        <div class="modal-body">
            <div style="font-size:13px;color:#666;margin-bottom:8px;">型号：${partNum}　颜色ID：${colorId}</div>
            ${row('① 离线缓存区', cached ? '已缓存' : '未缓存', cached, giteeUrl)}
            ${row('② Gitee', giteeOk ? '存在' : '不存在', giteeOk, giteeUrl)}
            ${row('③ RB数据库', rbUrl ? `${rbUrls.length}条记录` : '无记录', !!rbUrl, rbUrl || '（无）')}
            ${rbUrls.length > 1 ? `
            <div style="margin-bottom:12px;">
                <div style="font-size:12px;color:#999;margin-bottom:6px;">多条记录，点击卡片选择复制：</div>
                ${rbUrls.map(u => `
                <div onclick="navigator.clipboard.writeText('${u.replace(/'/g, "\\'")}').then(()=>{this.closest('.modal-overlay').remove();showToast('已复制所选RB图片URL')})" style="word-break:break-all;background:#FFF8E1;border:1px solid #FFE082;border-radius:6px;padding:8px;font-size:12px;color:#795548;margin-bottom:6px;cursor:pointer;">${u}</div>`).join('')}
            </div>` : ''}
            ${activeUrl
                ? `<button onclick="navigator.clipboard.writeText('${activeUrl.replace(/'/g, "\\'")}').then(()=>{this.closest('.modal-overlay').remove();showToast('已复制当前图片URL')})" style="width:100%;padding:8px;background:#2196F3;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;">复制当前图片URL</button>`
                : `<div style="font-size:14px;color:#999;text-align:center;padding:12px 0;">三级均未找到该零件图片</div>`}
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
}

async function searchFromDetail(partNum, colorId, partName) {
    // 关闭当前弹窗
    const overlay = document.querySelector('.modal-overlay.active');
    if (overlay) overlay.remove();
    
    // 切换到搜索页
    const btn = document.querySelector('.search-btn');
    await switchTab('search', btn);
    
    // 填充搜索条件
    document.getElementById('search-part-num').value = partNum;
    document.getElementById('search-part-name').value = partName;
    document.getElementById('search-color-id').value = colorId;
    updateColorPickButton(colorId);
    
    // 触发搜索
    await handleAdvancedSearch();
}

// 添加自定义图片
function addCustomImage(partNum, colorId) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content';
    sheet.style.maxWidth = '350px';

    sheet.innerHTML = `
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span class="modal-title" style="font-size:16px;font-weight:600;">添加零件图片</span>
            <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()" style="background:#f44336;color:white;padding:6px 14px;font-size:13px;border:none;border-radius:4px;cursor:pointer;">关闭</button>
        </div>
        <div class="modal-body">
            <div style="margin-bottom:12px;">
                <div style="font-size:13px;color:#666;margin-bottom:8px;">方式一：输入图片URL</div>
                <input type="text" id="custom-img-url" class="form-input" placeholder="https://example.com/image.jpg" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:4px;font-size:14px;box-sizing:border-box;">
                <button onclick="saveImageFromUrl('${partNum}', ${colorId})" style="margin-top:8px;width:100%;padding:8px;background:#2196F3;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;">使用URL图片</button>
            </div>
            <div style="text-align:center;color:#999;margin:12px 0;font-size:12px;">或</div>
            <div style="margin-bottom:12px;">
                <div style="font-size:13px;color:#666;margin-bottom:8px;">方式二：上传本地图片</div>
                <input type="file" id="custom-img-file" accept="image/*" style="width:100%;margin-bottom:8px;">
                <button onclick="uploadLocalImage('${partNum}', ${colorId})" style="width:100%;padding:8px;background:#4CAF50;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;">上传图片</button>
            </div>
            <div id="custom-img-preview" style="display:none;margin-top:12px;text-align:center;">
                <img id="custom-img-preview-img" style="max-width:100%;max-height:150px;border-radius:4px;">
                <div id="custom-img-status" style="margin-top:8px;font-size:13px;"></div>
            </div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
}

// 从URL保存图片（下载→离线缓存 + Gitee Parts-img）
async function saveImageFromUrl(partNum, colorId) {
    const urlInput = document.getElementById('custom-img-url');
    const url = urlInput ? urlInput.value.trim() : '';
    
    if (!url) {
        alert('请输入图片URL');
        return;
    }
    
    if (!url.match(/^https?:\/\//i)) {
        alert('请输入有效的URL（以http://或https://开头）');
        return;
    }
    
    const statusEl = document.getElementById('custom-img-status');
    statusEl.textContent = '⏳ 正在下载并保存图片...';
    statusEl.style.color = '#2196F3';
    
    try {
        // 下载图片并转为 base64
        const response = await fetch(url);
        if (!response.ok) throw new Error('图片下载失败');
        const blob = await response.blob();
        const imageBase64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        
        // ① 保存到浏览器离线缓存
        await savePartImageToOfflineCache(partNum, colorId, imageBase64);
        // ② 上传到 Gitee Parts-img
        const uploadResult = await uploadPartImageToGitee(partNum, colorId, imageBase64);
        
        statusEl.textContent = uploadResult.success
            ? '✓ 图片添加成功！'
            : `✓ 已存入离线缓存（Gitee上传失败: ${uploadResult.error}）`;
        statusEl.style.color = uploadResult.success ? '#4CAF50' : '#FF9800';
        setTimeout(() => {
            // 关闭所有弹窗并重新显示详情
            const overlays = document.querySelectorAll('.modal-overlay.active');
            overlays.forEach(o => o.remove());
            // 重新获取零件信息并显示详情
            refreshPartDetailWithCustomImage(partNum, colorId);
        }, 1000);
    } catch (e) {
        statusEl.textContent = `✗ 保存失败：${e.message}`;
        statusEl.style.color = '#f44336';
    }
}

// 上传本地图片
function uploadLocalImage(partNum, colorId) {
    const fileInput = document.getElementById('custom-img-file');
    if (!fileInput || !fileInput.files[0]) {
        alert('请选择图片文件');
        return;
    }
    
    const file = fileInput.files[0];
    if (!file.type.startsWith('image/')) {
        alert('请选择有效的图片文件');
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        alert('图片大小不能超过5MB');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        const imageDataUrl = e.target.result;
        const preview = document.getElementById('custom-img-preview');
        const previewImg = document.getElementById('custom-img-preview-img');
        const statusEl = document.getElementById('custom-img-status');
        
        preview.style.display = 'block';
        previewImg.src = imageDataUrl;
        statusEl.textContent = '⏳ 正在保存图片...';
        statusEl.style.color = '#2196F3';
        
        // ① 保存到浏览器离线缓存
        await savePartImageToOfflineCache(partNum, colorId, imageDataUrl);
        // ② 上传到 Gitee Parts-img
        const uploadResult = await uploadPartImageToGitee(partNum, colorId, imageDataUrl);
        
        statusEl.textContent = uploadResult.success
            ? '✓ 图片上传成功！'
            : `✓ 已存入离线缓存（Gitee上传失败: ${uploadResult.error}）`;
        statusEl.style.color = uploadResult.success ? '#4CAF50' : '#FF9800';
        setTimeout(() => {
            const overlays = document.querySelectorAll('.modal-overlay.active');
            overlays.forEach(o => o.remove());
            refreshPartDetailWithCustomImage(partNum, colorId);
        }, 1000);
    };
    reader.readAsDataURL(file);
}

// 管理自定义图片（从离线缓存读取当前图片）
async function manageCustomImage(partNum, colorId) {
    const cached = await getPartImageFromOfflineCache(partNum, colorId);
    const currentUrl = cached ? buildPartsImgUrl(partNum, colorId) : '';
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content';
    sheet.style.maxWidth = '350px';

    sheet.innerHTML = `
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span class="modal-title" style="font-size:16px;font-weight:600;">管理零件图片</span>
            <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()" style="background:#f44336;color:white;padding:6px 14px;font-size:13px;border:none;border-radius:4px;cursor:pointer;">关闭</button>
        </div>
        <div class="modal-body">
            <div style="text-align:center;margin-bottom:12px;">
                <div style="font-size:13px;color:#666;margin-bottom:8px;">当前自定义图片</div>
                <img src="${currentUrl}" style="max-width:100%;max-height:150px;border-radius:4px;border:1px solid #eee;">
            </div>
            <div style="display:flex;gap:8px;">
                <button onclick="changeCustomImage('${partNum}', ${colorId})" style="flex:1;padding:8px;background:#2196F3;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;">替换图片</button>
                <button onclick="removeCustomImage('${partNum}', ${colorId})" style="flex:1;padding:8px;background:#f44336;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;">删除图片</button>
            </div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
}

// 替换自定义图片
function changeCustomImage(partNum, colorId) {
    // 关闭当前管理弹窗
    const overlay = document.querySelector('.modal-overlay.active');
    if (overlay) overlay.remove();
    // 打开添加图片弹窗
    addCustomImage(partNum, colorId);
}

// 删除自定义图片（离线缓存 + Gitee Parts-img）
async function removeCustomImage(partNum, colorId) {
    if (!confirm('确定要删除自定义图片吗？')) return;
    
    // 删除浏览器离线缓存
    await deletePartImageFromOfflineCache(partNum, colorId);
    // 删除 Gitee Parts-img 仓库图片（失败不阻塞本地删除）
    await deletePartImageFromGitee(partNum, colorId);
    // 清除 RB 数据库中的 img_url，避免 getPartImageUrl 回退到旧图
    await clearPartImageUrlInRB(partNum, colorId);
    
    const overlay = document.querySelector('.modal-overlay.active');
    if (overlay) overlay.remove();
    
    // 刷新详情
    refreshPartDetailWithCustomImage(partNum, colorId);
}

// 刷新零件详情（带自定义图片更新）
async function refreshPartDetailWithCustomImage(partNum, colorId) {
    try {
        // 查找当前显示的零件详情中的零件数据
        // 从搜索结果或零件列表中找到对应零件
        const allParts = await getParts(null);
        const part = allParts.find(p => 
            p.part_num === partNum && String(p.color_id) === String(colorId)
        );
        
        if (part) {
            await showPartDetail(part);
        } else {
            alert('图片已更新，请刷新页面查看');
        }
    } catch (e) {
        console.error('刷新零件详情失败:', e);
        alert('图片已更新，请刷新页面查看');
    }
}

async function deletePartConfirm(partId) {
    const numericPartId = parseInt(partId);
    showPasswordWheel({
        rounds: 1,
        messages: ['请输入密码以确认删除零件'],
        onSuccess: async () => {
            const success = await deletePart(numericPartId);
            if (success) {
                // 关闭详情弹窗
                const overlay = document.querySelector('.modal-overlay.active');
                if (overlay) overlay.remove();
                // 刷新零件列表
                if (selectedBox) {
                    await loadParts(selectedBox.id);
                }
                // 从搜索结果中移除该零件卡片
                const card = document.querySelector(`.search-result-card[data-part-id="${partId}"]`);
                if (card) card.remove();
            } else {
                alert('删除零件失败');
            }
        }
    });
}

// 显示合并零件选择器：在当前盒子中查找相同零件（型号、颜色、状态一致），选择目标合并
async function showMergePartSelector(currentPart) {
    // 优先使用当前零件所属的盒子，避免从搜索结果进入时全局 selectedBox 不对应
    const boxId = currentPart.box_id || (selectedBox ? selectedBox.id : null);
    if (!boxId) {
        alert('未选中盒子，无法合并');
        return;
    }

    // 获取当前盒子中的所有零件
    const allParts = await getParts(boxId);
    
    // 查找相同条件的零件（排除自己）
    const sameParts = allParts.filter(p =>
        p.part_num === currentPart.part_num &&
        p.color_id === currentPart.color_id &&
        Boolean(p.is_new) === Boolean(currentPart.is_new) &&
        p.id !== currentPart.id
    );

    if (sameParts.length === 0) {
        alert('当前盒子中未找到相同零件（型号、颜色、状态都一致），无法合并');
        return;
    }

    // 创建对话框，参考添加零件时的重复零件对话框样式
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'merge-part-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content add-part-modal';

    // 生成零件卡片 HTML
    let partsCardsHtml = '';
    for (let i = 0; i < sameParts.length; i++) {
        const part = sameParts[i];
        const imgUrl = await getPartImageUrl(part.part_num, part.color_id);
        const isSelected = i === 0; // 默认选中第一个
        partsCardsHtml += `
            <div class="dup-part-card ${isSelected ? 'selected' : ''}" data-part-id="${part.id}">
                <div class="dup-part-left">
                    <div class="dup-part-image">
                        ${imgUrl ? `<img src="${imgUrl}" alt="${part.part_num}">` : ''}
                    </div>
                </div>
                <div class="dup-part-right">
                    <div class="dup-part-num">${part.part_num}</div>
                    <div class="dup-part-color">C: ${part.color_id}</div>
                    <div class="dup-part-status ${part.is_new ? 'new' : 'used'}">
                        ${part.is_new ? '新' : '旧'}
                    </div>
                    <div class="dup-part-quantity"><span class="dup-part-x">x</span>${part.quantity}</div>
                </div>
            </div>
        `;
    }

    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">合并零件</span>
            <button class="btn-cancel" id="merge-cancel-btn">取消</button>
        </div>
        <div class="modal-body" style="padding: 0;">
            <div style="padding: 20px 16px 12px;">
                <div style="font-size: 16px; color: #333; margin-bottom: 12px; text-align: center;">
                    当前零件：${currentPart.part_num}（${currentPart.quantity} 个）<br>
                    选择要合并到的目标零件
                </div>
            </div>
            <div class="dup-parts-scroll">
                ${partsCardsHtml}
            </div>
            <div style="padding: 0 16px 20px; margin-top: 12px;">
                <div style="font-size: 14px; color: #666; margin-bottom: 16px; text-align: center;">
                    合并后当前零件将被删除，数量累加至目标零件
                </div>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="merge-confirm-btn" class="btn-save" style="flex: 1; background-color: #27ae60;">确认合并</button>
                </div>
            </div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    let selectedTargetId = sameParts[0].id;

    // 绑定卡片选择事件
    const partCards = sheet.querySelectorAll('.dup-part-card');
    partCards.forEach(card => {
        card.addEventListener('click', () => {
            partCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedTargetId = parseInt(card.dataset.partId);
        });
    });

    // 绑定取消按钮
    document.getElementById('merge-cancel-btn').addEventListener('click', () => {
        overlay.remove();
    });

    // 绑定确认合并按钮
    document.getElementById('merge-confirm-btn').addEventListener('click', async () => {
        const targetPart = sameParts.find(p => p.id === selectedTargetId);
        if (!targetPart) {
            alert('请选择目标零件');
            return;
        }

        // 计算新数量
        const newQty = targetPart.quantity + currentPart.quantity;
        
        // 更新目标零件数量
        const updateSuccess = await updatePart(selectedTargetId, { quantity: newQty });
        if (!updateSuccess) {
            alert('更新目标零件数量失败');
            return;
        }

        // 删除当前零件
        const deleteSuccess = await deletePart(currentPart.id);
        if (!deleteSuccess) {
            alert('删除当前零件失败，请重试');
            return;
        }

        // 关闭弹窗
        overlay.remove();
        // 关闭详情弹窗
        const detailOverlay = document.querySelector('.modal-overlay.active');
        if (detailOverlay) detailOverlay.remove();
        // 刷新零件列表
        if (selectedBox) {
            await loadParts(selectedBox.id);
        }
        // 从搜索结果中移除当前零件卡片
        const card = document.querySelector(`.search-result-card[data-part-id="${currentPart.id}"]`);
        if (card) card.remove();

        alert(`合并成功！已将 ${currentPart.quantity} 个零件合并到目标零件，新数量为 ${newQty}`);
    });
}

async function goBackToRepositories() {
    setSelectedBox(null);
    // 重置 header 状态
    document.getElementById('selected-box-name').textContent = '未命名';
    document.getElementById('repo-badge-wrapper').style.display = 'none';
    document.getElementById('repo-at').style.display = 'none';
    document.getElementById('box-sequence').textContent = '';
    const btn = document.querySelector('.repo-btn');
    await switchTab('repositories', btn);
    if (selectedRepository) {
        await loadBoxes(selectedRepository.id);
    }
}

function showCSVImporter() {
    if (!selectedBox) {
        alert('请先选择一个盒子');
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content csv-importer-modal';

    sheet.innerHTML = `
        <div class="csv-imp-header">
            <span class="csv-imp-title">批量导入零件</span>
            <button class="csv-imp-btn-back" onclick="this.closest('.modal-overlay').remove()">返回</button>
        </div>
        <div class="csv-imp-toolbar">
            <button class="csv-imp-btn-template" onclick="downloadCSVTemplate()">格式模版</button>
            <button class="csv-imp-btn-import" onclick="document.getElementById('csv-file-input').click()">导入文件</button>
            <input type="file" id="csv-file-input" accept=".csv" style="display: none;">
        </div>
        <div class="csv-imp-body" id="csv-imp-body">
            <div class="csv-imp-tip">请先下载格式模版，按格式填写后导入</div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const fileInput = document.getElementById('csv-file-input');
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            processCSVFile(file);
        }
    });
}

// 生成并下载CSV模版
function downloadCSVTemplate() {
    const today = new Date();
    const dateStr = today.getFullYear().toString() +
        String(today.getMonth() + 1).padStart(2, '0') +
        String(today.getDate()).padStart(2, '0');

    // 生成序号（基于时间戳的后4位作为序号）
    const seq = String(Date.now()).slice(-4);

    const fileName = `零件${dateStr}-${seq}.csv`;

    const csvContent = 'part_num,name,color_id,quantity,is_new\n' +
        '3001,,1,10,T\n' +
        '3002,,4,5,F\n' +
        '3003,,0,20,T\n';

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function parseCSVContent(content) {
    // 去掉 BOM（UTF-8 BOM \ufeff）
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }
    // 统一换行符：\r\n → \n，再 \r → \n
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const lines = content.split('\n');
    const rows = [];

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        const row = parseCSVLine(line);
        rows.push(row);
    }

    return rows;
}

function parseCSVLine(line) {
    const result = [];
    let currentField = '';
    let inQuotes = false;

    for (const char of line) {
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(currentField.trim());
            currentField = '';
        } else {
            currentField += char;
        }
    }

    result.push(currentField.trim());
    return result;
}

async function processCSVFile(file) {
    const reader = new FileReader();

    reader.onload = async (e) => {
        const content = e.target.result;
        const rows = parseCSVContent(content);

        if (rows.length < 2) {
            alert('CSV文件内容为空或格式不正确');
            return;
        }

        const headers = rows[0];
        const data = rows.slice(1);

        const importData = data.map(row => {
            const item = {};
            headers.forEach((header, index) => {
                const cleanHeader = header.trim().toLowerCase();
                const value = row[index] != null ? String(row[index]).trim() : '';
                item[cleanHeader] = value;
            });
            return item;
        });

        await showImportConfirmation(importData);
    };

    reader.readAsText(file);
}

// 显示带图片的确认表
async function showImportConfirmation(data) {
    const body = document.getElementById('csv-imp-body');

    body.innerHTML = '<div class="csv-imp-loading">正在加载零件信息...</div>';

    // 获取所有颜色信息
    const colors = await getAllColors();
    const colorMap = {};
    (colors || []).forEach(c => { colorMap[c.id] = c; });

    // 获取盒子中已有零件，用于重复检测
    const existingParts = await getParts(selectedBox.id);
    const existingMap = {};
    (existingParts || []).forEach(p => {
        const key = `${p.part_num}_${p.color_id}_${p.is_new ? 1 : 0}`;
        existingMap[key] = p;
    });

    // 为每个零件匹配名称和图片
    const enrichedData = [];
    for (const item of data) {
        const partNum = (item.part_num || '').trim();
        const rawColorId = item.color_id;
        const colorId = (rawColorId !== '' && rawColorId !== undefined && rawColorId !== null) ? parseInt(rawColorId) : 0;
        const quantity = parseInt(item.quantity) || 0;

        // 始终从RB数据库获取零件名称，忽略CSV中的name
        let partName = '';
        if (partNum) {
            try {
                const rbPart = await getPartByNum(partNum);
                if (rbPart && rbPart.name) {
                    partName = rbPart.name;
                }
            } catch (e) {
                console.warn('获取零件名称失败:', e);
            }
        }

        // 获取颜色信息
        const colorInfo = colorMap[colorId] || colorMap[parseInt(colorId)];
        const colorName = colorInfo ? colorInfo.name : '未知';
        const colorRgb = colorInfo && colorInfo.rgb ?
            (colorInfo.rgb.startsWith('#') ? colorInfo.rgb : '#' + colorInfo.rgb) : '#FFFFFF';

        // 先解析 is_new，再进行重复检测（状态是唯一性的关键标识）
        const rawIsNew = item.is_new;
        const v = String(rawIsNew ?? '').trim().toUpperCase();
        const parsedIsNew = v === 'T' || v === 'TRUE' || v === '1' || v === 'Y' || rawIsNew === true;
        console.log(`[CSV导入] part=${partNum} is_new原始值="${rawIsNew}" (type:${typeof rawIsNew}) → 解析=${parsedIsNew} (v="${v}")`);

        // 检测是否重复（型号+颜色+新旧状态三者一致才视为重复）
        const existingKey = `${partNum}_${colorId}_${parsedIsNew ? 1 : 0}`;
        const existingPart = existingMap[existingKey];

        enrichedData.push({
            part_num: partNum,
            name: partName,
            color_id: colorId,
            color_name: colorName,
            color_rgb: colorRgb,
            quantity: quantity,
            is_new: parsedIsNew,
            existing: existingPart ? true : false,
            existing_id: existingPart ? existingPart.id : null,
            existing_quantity: existingPart ? existingPart.quantity : 0,
            action: existingPart ? 'merge' : 'new' // 默认重复的选merge，新的选new
        });
    }

    window.currentCSVData = enrichedData;

    // 统计重复数量
    const duplicateCount = enrichedData.filter(d => d.existing).length;

    // 渲染确认表
    let html = '';

    if (duplicateCount > 0) {
        html += `<div class="csv-imp-duplicate-tip">检测到 ${duplicateCount} 个零件在盒子中已存在，可选择合并数量或新增一条记录</div>`;
    }

    html += '<div class="csv-imp-confirm-list">';

    enrichedData.forEach((item, idx) => {
        const isNew = item.is_new;
        const brightness = getColorBrightness(item.color_rgb);
        const textColor = brightness > 128 ? '#000' : '#fff';

        html += `
            <div class="csv-imp-card ${item.existing ? 'csv-imp-card-duplicate' : ''}" data-idx="${idx}">
                <div class="csv-imp-card-img" id="csv-imp-img-${idx}">
                    <div class="csv-imp-img-loading">加载中</div>
                </div>
                <div class="csv-imp-card-info">
                    <div class="csv-imp-card-row">
                        <span class="csv-imp-card-label">型号：</span>
                        <span class="csv-imp-card-value">${item.part_num}</span>
                    </div>
                    <div class="csv-imp-card-row">
                        <span class="csv-imp-card-label">名称：</span>
                        <span class="csv-imp-card-value">${item.name || '未知'}</span>
                    </div>
                    <div class="csv-imp-card-row">
                        <span class="csv-imp-card-label">颜色：</span>
                        <span class="csv-imp-card-color-chip" style="background:${item.color_rgb};color:${textColor}">${item.color_name}</span>
                    </div>
                    <div class="csv-imp-card-row">
                        <span class="csv-imp-card-label">数量：</span>
                        <span class="csv-imp-card-value csv-imp-qty">${item.quantity}</span>
                        <span class="csv-imp-card-status ${isNew ? 'new' : 'used'}">${isNew ? '新品' : '旧品'}</span>
                    </div>
                    ${item.existing ? `
                    <div class="csv-imp-card-row csv-imp-duplicate-row">
                        <span class="csv-imp-card-label">已有${item.existing_quantity}个</span>
                        <div class="csv-imp-action-switch">
                            <div class="csv-imp-action-item ${item.action === 'merge' ? 'active' : ''}" onclick="setImportAction(${idx}, 'merge')">合并</div>
                            <div class="csv-imp-action-item ${item.action === 'new' ? 'active' : ''}" onclick="setImportAction(${idx}, 'new')">新增</div>
                        </div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    });

    html += '</div>';
    html += '<div class="csv-imp-confirm-actions">';
    html += '<button class="csv-imp-btn-cancel" onclick="showCSVImporter()">取消</button>';
    html += '<button class="csv-imp-btn-confirm" onclick="confirmCSVImport()">确认导入</button>';
    html += '</div>';

    body.innerHTML = html;

    // 异步加载每个零件的图片
    enrichedData.forEach((item, idx) => {
        getPartImageUrl(item.part_num, item.color_id).then(imgUrl => {
            const imgContainer = document.getElementById(`csv-imp-img-${idx}`);
            if (imgContainer) {
                if (imgUrl) {
                    imgContainer.innerHTML = `<img src="${imgUrl}" alt="${item.name || ''}" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=csv-imp-no-img>暂无</div>'">`;
                } else {
                    imgContainer.innerHTML = '<div class="csv-imp-no-img">暂无</div>';
                }
            }
        });
    });
}

// 设置重复零件的处理方式
function setImportAction(idx, action) {
    if (!window.currentCSVData) return;
    window.currentCSVData[idx].action = action;

    // 更新UI - 使用新的div选择器
    const row = document.querySelectorAll('.csv-imp-card-duplicate .csv-imp-action-switch')[idx];
    if (row) {
        const items = row.querySelectorAll('.csv-imp-action-item');
        if (items[0]) items[0].classList.toggle('active', action === 'merge');
        if (items[1]) items[1].classList.toggle('active', action === 'new');
    }
}

// 计算颜色亮度
function getColorBrightness(hex) {
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substr(0, 2), 16);
    const g = parseInt(cleanHex.substr(2, 2), 16);
    const b = parseInt(cleanHex.substr(4, 2), 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
}

async function confirmCSVImport() {
    if (!selectedBox || !window.currentCSVData) return;
    doConfirmCSVImport();
}

// 实际执行导入的内部函数
async function doConfirmCSVImport() {
    if (!selectedBox || !window.currentCSVData) return;

    const body = document.getElementById('csv-imp-body');
    body.innerHTML = '<div class="csv-imp-loading">正在导入...</div>';

    const items = window.currentCSVData;
    let successCount = 0;
    const errors = [];

    // 处理合并项：更新已有零件数量
    const mergeItems = items.filter(it => it.existing && it.action === 'merge');
    for (const item of mergeItems) {
        try {
            const newQty = item.existing_quantity + item.quantity;
            await updatePart(item.existing_id, { quantity: newQty });
            successCount++;
        } catch (e) {
            errors.push({ part_num: item.part_num, error: `合并失败: ${e.message}` });
        }
    }

    // 处理新增项（全新零件 + 选择新增的重复零件）
    const newItems = items.filter(it => !it.existing || it.action === 'new');
    if (newItems.length > 0) {
        // 先重置自增序列，避免主键冲突
        try {
            await resetSequencesViaSupabase();
        } catch (e) {
            console.warn('重置序列失败:', e.message);
        }

        for (const item of newItems) {
            const partData = {
                box_id: selectedBox.id,
                part_num: item.part_num,
                name: item.name || item.part_num,
                color_id: item.color_id,
                quantity: item.quantity,
                is_new: item.is_new
            };

            const result = await batchCreateParts([partData]);
            if (result.success) {
                successCount++;
            } else {
                errors.push({ part_num: item.part_num, error: result.errors[0]?.error || '未知错误' });
            }
        }
    }

    // 显示结果
    if (errors.length === 0) {
        body.innerHTML = `
            <div class="csv-imp-success">
                <div class="csv-imp-success-icon">✓</div>
                <div>导入成功！</div>
                <div>成功导入/更新 ${successCount} 个零件</div>
                <button class="csv-imp-btn-close" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        `;
    } else {
        let errorHtml = `
            <div class="csv-imp-error">
                <div class="csv-imp-error-icon">✗</div>
                <div>导入完成，但有部分失败</div>
                <div>成功处理 ${successCount} 个零件</div>
                <div class="csv-imp-error-list">
        `;
        errors.forEach(e => {
            errorHtml += `<div>${e.part_num}: ${e.error}</div>`;
        });
        errorHtml += `
                </div>
                <button class="csv-imp-btn-close" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        `;
        body.innerHTML = errorHtml;
    }

    if (selectedBox) {
        loadParts(selectedBox.id);
    }
}

async function initializeApp() {
    try {
        const P = 46;
        document.documentElement.style.setProperty('--P', P);
        document.documentElement.style.setProperty('--card-width', (2 * P) + 'px');
        document.documentElement.style.setProperty('--card-height', (1.4 * P) + 'px');
        document.documentElement.style.setProperty('--grid-width', (4 * P) + 'px');
        
        // 启动时检查并建立 RB 数据库（不阻塞主流程）
        loadRBOnStartup().catch(e => {
            console.error('RB数据库初始化失败:', e);
            showRBStatusHint('rb-failed');
        });
        
        const repoBtn = document.querySelector('.nav button.repo-btn');
        await switchTab('repositories', repoBtn);
        
        // 初始化零件页左右滑动手势
        initPartsSwipeGesture();
        
        // 监听颜色ID输入框变化，手动输入时也更新按钮样式
        const colorIdInput = document.getElementById('search-color-id');
        if (colorIdInput) {
            colorIdInput.addEventListener('input', (e) => {
                const val = e.target.value.trim();
                if (val) {
                    updateColorPickButton(val);
                } else {
                    updateColorPickButton('');
                }
            });
        }
    } catch (error) {
        console.error('应用初始化失败:', error);
        const list = document.getElementById('repositories-list');
        if (list) {
            list.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">无法连接到数据库，请检查网络连接或稍后重试</div>';
        }
    }
}

// 启动时自动建立 RB 数据库（如果不存在）
async function loadRBOnStartup() {
    try {
        showRBStatusHint('rb-loading');
        
        const hasLocalData = await hasLocalRBData();
        if (hasLocalData) {
            console.log('RB本地数据库已存在，使用离线数据');
            // 升级场景：旧库无 weights store 数据，补充加载 weights.json
            try {
                const weightsCount = await countRecords(RB_STORES.WEIGHTS);
                if (weightsCount === 0) {
                    const weightsText = await fetchRBFile('weights.json');
                    if (weightsText) {
                        const result = await importWeightsFromJSON(JSON.parse(weightsText));
                        if (result.success) {
                            console.log(`补充加载重量数据: ${result.count}条`);
                        }
                    }
                }
            } catch (e) {
                console.warn('补充加载重量数据失败:', e.message);
            }
            showRBStatusHint('rb-ready');
            return;
        }
        
        console.log('RB本地数据库不存在，从Parts-RB读取CSV文件建立...');
        
        // 从 Parts-RB 读取 6 个 CSV 文件
        const csvFiles = [
            { name: 'colors.csv', store: RB_STORES.COLORS, schemaKey: 'colors', label: '颜色' },
            { name: 'parts.csv', store: RB_STORES.PARTS, schemaKey: 'parts', label: '零件' },
            { name: 'part_categories.csv', store: RB_STORES.PART_CATEGORIES, schemaKey: 'part_categories', label: '类别' },
            { name: 'elements.csv', store: RB_STORES.ELEMENTS, schemaKey: 'elements', label: '元素' },
            { name: 'inventory_parts.csv', store: RB_STORES.INVENTORY_PARTS, schemaKey: 'inventory_parts', label: '库存' },
            { name: 'part_relationships.csv', store: RB_STORES.PART_RELATIONSHIPS, schemaKey: 'part_relationships', label: '关系' }
        ];

        let successCount = 0;
        let failCount = 0;

        for (const file of csvFiles) {
            try {
                // inventory_parts 已分片（避免 Gitee contents API 10MiB 截断），需合并下载
                const csvText = file.schemaKey === 'inventory_parts'
                    ? await fetchRBInventoryParts()
                    : await fetchRBFile(file.name);
                if (!csvText) {
                    failCount++;
                    continue;
                }
                const { data } = parseRBCSV(csvText);
                const typedData = convertRBData(file.schemaKey, data);
                await importRBData(file.store, typedData);
                successCount++;
            } catch (error) {
                console.error(`加载 ${file.name} 失败:`, error);
                failCount++;
            }
        }

        // 读取 weights.json（离线重量数据，供称重计算优先使用）
        try {
            const weightsText = await fetchRBFile('weights.json');
            if (weightsText) {
                const weightsJson = JSON.parse(weightsText);
                const result = await importWeightsFromJSON(weightsJson);
                if (result.success) {
                    console.log(`重量数据加载成功: ${result.count}条`);
                } else {
                    console.warn('重量数据加载失败:', result.error);
                }
            }
        } catch (error) {
            console.error('加载 weights.json 失败:', error);
        }

        if (successCount === csvFiles.length) {
            console.log('RB数据库建立成功');
            showRBStatusHint('rb-ready');
        } else {
            console.warn(`RB数据库部分加载: 成功${successCount}, 失败${failCount}`);
            showRBStatusHint('rb-partial');
        }
    } catch (error) {
        console.error('启动时建立RB数据库失败:', error);
        showRBStatusHint('rb-failed');
    }
}

// 显示 RB 状态提示
function showRBStatusHint(status) {
    const hint = document.getElementById('rb-status-hint');
    const idbInfo = document.getElementById('idb-version-info');
    if (!hint) {
        console.warn('rb-status-hint 元素未找到');
        return;
    }
    
    // 更新 IndexedDB 版本信息
    if (idbInfo && typeof RB_DB_VERSION !== 'undefined') {
        idbInfo.textContent = `IndexedDB: ${RB_DB_NAME} v${RB_DB_VERSION}`;
    }
    
    const messages = {
        'rb-ready': { 
            text: '✓ RB数据库已就绪', 
            color: '#4CAF50' 
        },
        'rb-partial': { 
            text: '⚠ RB数据库部分加载，请点击"更新RB"', 
            color: '#FF9800' 
        },
        'rb-failed': { 
            text: '✗ RB数据库加载失败，请点击"更新RB"', 
            color: '#f44336' 
        },
        'rb-empty': {
            text: 'ℹ RB数据库为空，请点击"更新RB"建立',
            color: '#9E9E9E'
        },
        'rb-loading': {
            text: '⏳ RB数据库加载中...',
            color: '#2196F3'
        }
    };
    
    const msg = messages[status];
    if (msg) {
        hint.textContent = msg.text;
        hint.style.color = msg.color;
        hint.style.display = 'block';
        console.log('RB状态提示:', msg.text);
    }
    
    // 异步获取统计数据并更新
    if (status === 'rb-ready' || status === 'rb-partial') {
        getRBStats().then(stats => {
            const totalCount = stats ? Object.values(stats).reduce((a, b) => a + b, 0) : 0;
            if (status === 'rb-ready' && totalCount === 0) {
                hint.textContent = messages['rb-empty'].text;
                hint.style.color = messages['rb-empty'].color;
            } else if (totalCount > 0) {
                hint.textContent = `${msg.text} (共 ${totalCount} 条数据)`;
            }
        }).catch(e => console.error('获取RB统计失败:', e));
    }
}

async function initializeDatabase() {
    showPasswordWheel({
        rounds: 3,
        messages: ['请输入初始化密码（第 1/3 次）', '请再次输入密码确认（第 2/3 次）', '请再次输入密码确认（第 3/3 次）'],
        onSuccess: async () => {
            if (!confirm('确定要初始化数据库吗？这将删除所有现有数据！')) {
                return;
            }
            
            try {
                // 先删除所有零件
                const allParts = await supabaseRequest('parts', { select: 'id' });
                if (allParts && allParts.length > 0) {
                    for (const part of allParts) {
                        try { await deletePart(part.id); } catch (e) {}
                    }
                }
                
                // 再删除所有盒子
                const allBoxes = await supabaseRequest('boxes', { select: 'id' });
                if (allBoxes && allBoxes.length > 0) {
                    for (const box of allBoxes) {
                        try { await deleteBox(box.id); } catch (e) {}
                    }
                }
                
                // 最后删除所有仓库
                let repos = await getRepositories();
                for (const repo of repos) {
                    try { await deleteRepository(repo.id); } catch (e) {}
                }
                
                // 重置所有自增序列（通过 Supabase RPC，无需 CloudBase 后端）
                try {
                    await resetSequencesViaSupabase();
                    console.log('序列已重置');
                } catch (e) {
                    console.warn('重置序列失败（ID可能不从0开始）:', e.message);
                }
                
                // 验证是否清空
                repos = await getRepositories();
                if (repos.length > 0) {
                    console.warn('警告：仍有仓库未被删除:', repos.map(r => r.name));
                }
                
                // 创建唯一的临时仓库（指定ID为0）
                try {
                    await supabaseRequest('repositories', {
                        method: 'POST',
                        body: { id: 0, name: '临时仓库' }
                    });
                    console.log('已创建临时仓库，ID: 0');
                } catch (e) {
                    // 如果指定ID失败，回退到普通创建
                    console.warn('指定ID创建失败，回退到普通创建:', e.message);
                    await createRepository('临时仓库');
                }
                
                alert('数据库初始化成功！已创建默认仓库"临时仓库"');
                loadRepositories();
            } catch (error) {
                console.error('初始化数据库失败:', error);
                alert('初始化数据库失败: ' + error.message);
            }
        }
    });
}

async function backupData() {
    try {
        const repos = await getRepositories();
        let allBoxes = [];
        let allParts = [];
        
        for (const repo of repos) {
            const boxes = await getBoxes(repo.id);
            allBoxes = allBoxes.concat(boxes.map(b => ({ ...b, repository_id: repo.id })));
            
            for (const box of boxes) {
                const parts = await getParts(box.id);
                allParts = allParts.concat(parts.map(p => ({ ...p, box_id: box.id })));
            }
        }
        
        const backup = {
            timestamp: new Date().toISOString(),
            repositories: repos,
            boxes: allBoxes,
            parts: allParts
        };
        
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `parts_backup_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        alert('数据备份成功！');
    } catch (error) {
        console.error('数据备份失败:', error);
        alert('数据备份失败: ' + error.message);
    }
}

async function restoreData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!confirm('确定要恢复数据吗？这将覆盖当前所有数据！')) {
            return;
        }
        
        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const backup = JSON.parse(e.target.result);
                
                const existingRepos = await getRepositories();
                for (const repo of existingRepos) {
                    await deleteRepository(repo.id);
                }
                
                const repoMap = {};
                for (const repo of backup.repositories) {
                    const newRepo = await createRepository(repo.name);
                    if (newRepo) {
                        repoMap[repo.id] = newRepo.id;
                    }
                }
                
                const boxMap = {};
                for (const box of backup.boxes) {
                    const newBox = await createBox(
                        repoMap[box.repository_id] || Object.values(repoMap)[0],
                        box.box_number || 1,
                        box.name
                    );
                    if (newBox) {
                        boxMap[box.id] = newBox.id;
                    }
                }
                
                for (const part of backup.parts) {
                    await createPart({
                        box_id: boxMap[part.box_id] || Object.values(boxMap)[0],
                        part_num: part.part_num,
                        name: part.name,
                        color_id: part.color_id || 1,
                        is_new: part.is_new !== undefined ? part.is_new : true,
                        quantity: part.quantity || 1
                    });
                }
                
                alert('数据恢复成功！');
                loadRepositories();
            };
            
            reader.readAsText(file);
        } catch (error) {
            console.error('数据恢复失败:', error);
            alert('数据恢复失败: ' + error.message);
        }
    };
    
    input.click();
}

function clearCache() {
    if (!confirm('确定要清除本地缓存吗？')) {
        return;
    }
    
    localStorage.clear();
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            registrations.forEach(reg => {
                reg.unregister();
            });
        });
    }
    
    alert('本地缓存已清除');
}

function reloadApp() {
    if (confirm('确定要重启应用吗？')) {
        location.reload();
    }
}

// RB分片：选择本地 inventory_parts.csv，分割为 <4MB 分片并上传到 Gitee parts-rb 仓库
// 分片命名 inventory_parts_1.csv ...（序号从1开始），上传后写入清单，更新RB按清单合并读取
function splitAndUploadRB() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv,text/csv';
    fileInput.style.display = 'none';
    fileInput.onchange = () => {
        document.body.removeChild(fileInput);
        const file = fileInput.files && fileInput.files[0];
        if (file) {
            showSplitUploadConfirm(file);
        }
    };
    document.body.appendChild(fileInput);
    fileInput.click();
}

// 分片上传确认弹窗（展示文件信息与预计分片数）
function showSplitUploadConfirm(file) {
    const estimatedShards = Math.max(1, Math.ceil(file.size / (4 * 1024 * 1024)));
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width: 420px; text-align: center;">
            <div class="modal-header">
                <span class="modal-title">RB分片上传</span>
            </div>
            <div class="modal-body">
                <div style="font-size: 13px; color: #666; text-align: left; line-height: 2;">
                    <div>文件名：${file.name}</div>
                    <div>文件大小：${(file.size / 1024 / 1024).toFixed(2)} MB</div>
                    <div>预计分片数：${estimatedShards} 个（每个 &lt;4MB）</div>
                </div>
                <div style="font-size: 12px; color: #999; margin-top: 10px; line-height: 1.8;">
                    上传前将按 (part_num, color_id, img_url) 去重：仅移除完全重复的行，
                    保留全部不同零件/颜色/图片记录，确保数据完整。去重后再分割上传到 Gitee
                    parts-rb 仓库，命名为 inventory_parts_1.csv、inventory_parts_2.csv ...，
                    完成后自动写入分片清单，更新RB将按清单合并读取。
                </div>
                <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
                    <button class="btn-save" id="split-upload-start" style="padding: 8px 24px;">开始上传</button>
                    <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">取消</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    const startBtn = overlay.querySelector('#split-upload-start');
    startBtn.onclick = () => {
        overlay.remove();
        doSplitUploadRB(file);
    };
}

// 执行分片上传，展示进度（含429限流重试提示）
async function doSplitUploadRB(file) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width: 420px; text-align: center;">
            <div class="modal-header">
                <span class="modal-title">RB分片上传</span>
            </div>
            <div class="modal-body">
                <div style="padding: 20px 0;">
                    <div class="rb-progress-bar" style="background: #e0e0e0; border-radius: 10px; height: 20px; overflow: hidden; margin: 10px 0;">
                        <div id="split-upload-progress-fill" style="background: #FF5722; height: 100%; width: 0%; transition: width 0.3s;"></div>
                    </div>
                    <div id="split-upload-progress-text" style="font-size: 14px; color: #666; margin-top: 10px;">准备分割...</div>
                    <div id="split-upload-progress-detail" style="font-size: 12px; color: #999; margin-top: 5px;"></div>
                </div>
                <div id="split-upload-result" style="display: none;"></div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const updateProgress = (percent, text, detail) => {
        const fill = document.getElementById('split-upload-progress-fill');
        const textEl = document.getElementById('split-upload-progress-text');
        const detailEl = document.getElementById('split-upload-progress-detail');
        if (fill) fill.style.width = Math.round(percent * 100) + '%';
        if (text && textEl) textEl.textContent = text;
        if (detail && detailEl) detailEl.textContent = detail;
    };

    try {
        updateProgress(0.03, '正在分割文件...', file.name);

        const result = await uploadRBInventoryShards(file, {
            onProgress: (p) => {
                let percent;
                if (p.phase === 'manifest') {
                    percent = 0.95;
                } else if (p.shardTotal > 0) {
                    percent = 0.03 + (p.shardIndex / p.shardTotal) * 0.92;
                } else {
                    percent = 0.5;
                }
                updateProgress(percent, p.message || '', '');
            }
        });

        updateProgress(1, '分片上传完成！', '');

        setTimeout(() => {
            const resultDiv = document.getElementById('split-upload-result');
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `
                <div style="padding: 15px; margin-top: 10px;">
                    <div style="font-size: 16px; margin-bottom: 10px;">✓ 上传成功</div>
                    <div style="font-size: 12px; color: #666; text-align: left; line-height: 1.8;">
                        <div>分片数量：${result.count} 个</div>
                        <div>数据行数：${result.rows} 条（去重前 ${result.source_rows} 条）</div>
                        <div style="word-break: break-all;">文件：${result.files.join(', ')}</div>
                    </div>
                    <button class="btn-save" style="margin-top: 15px;" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                </div>
            `;
        }, 500);

    } catch (error) {
        console.error('RB分片上传失败:', error);
        updateProgress(1, '上传失败', error.message);

        setTimeout(() => {
            const resultDiv = document.getElementById('split-upload-result');
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `
                <div style="padding: 15px; margin-top: 10px; color: #f44336;">
                    <div style="font-size: 16px; margin-bottom: 10px;">✗ 上传失败</div>
                    <div style="font-size: 12px; margin: 10px 0; word-break: break-all;">${error.message}</div>
                    <button class="btn-save" style="margin-top: 15px;" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                </div>
            `;
        }, 500);
    }
}

// 更新 RB 数据库（从 Parts-RB 读取 CSV，更新离线数据库）
async function updateRB() {
    if (!confirm('确定要从 Parts-RB 读取最新的 CSV 数据吗？\n这将更新本地 RB 数据库。')) {
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width: 400px; text-align: center;">
            <div class="modal-header">
                <span class="modal-title">更新RB数据库</span>
            </div>
            <div class="modal-body">
                <div id="rb-progress" style="padding: 20px 0;">
                    <div class="rb-progress-bar" style="background: #e0e0e0; border-radius: 10px; height: 20px; overflow: hidden; margin: 10px 0;">
                        <div id="rb-progress-fill" style="background: #00BCD4; height: 100%; width: 0%; transition: width 0.3s;"></div>
                    </div>
                    <div id="rb-progress-text" style="font-size: 14px; color: #666; margin-top: 10px;">准备更新...</div>
                    <div id="rb-progress-detail" style="font-size: 12px; color: #999; margin-top: 5px;"></div>
                </div>
                <div id="rb-result" style="display: none;"></div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const updateProgress = (percent, text, detail) => {
        document.getElementById('rb-progress-fill').style.width = Math.round(percent * 100) + '%';
        if (text) document.getElementById('rb-progress-text').textContent = text;
        if (detail) document.getElementById('rb-progress-detail').textContent = detail;
    };

    try {
        // 1. 从 Parts-RB 读取 6 个 CSV 文件
        updateProgress(0.05, '从Parts-RB仓库读取CSV文件...', '');
        
        const csvFiles = [
            { name: 'colors.csv', store: RB_STORES.COLORS, schemaKey: 'colors', label: '颜色' },
            { name: 'parts.csv', store: RB_STORES.PARTS, schemaKey: 'parts', label: '零件' },
            { name: 'part_categories.csv', store: RB_STORES.PART_CATEGORIES, schemaKey: 'part_categories', label: '类别' },
            { name: 'elements.csv', store: RB_STORES.ELEMENTS, schemaKey: 'elements', label: '元素' },
            { name: 'inventory_parts.csv', store: RB_STORES.INVENTORY_PARTS, schemaKey: 'inventory_parts', label: '库存' },
            { name: 'part_relationships.csv', store: RB_STORES.PART_RELATIONSHIPS, schemaKey: 'part_relationships', label: '关系' }
        ];

        let successCount = 0;
        let failCount = 0;
        const importResults = {};

        for (let i = 0; i < csvFiles.length; i++) {
            const file = csvFiles[i];
            const progress = 0.1 + (i / csvFiles.length) * 0.5;
            
            updateProgress(progress, `读取 ${file.label} (${i + 1}/${csvFiles.length})...`, file.name);

            try {
                // inventory_parts 已分片（避免 Gitee contents API 10MiB 截断），需合并下载
                const csvText = file.schemaKey === 'inventory_parts'
                    ? await fetchRBInventoryParts()
                    : await fetchRBFile(file.name);
                if (!csvText) {
                    failCount++;
                    importResults[file.schemaKey] = false;
                    updateProgress(progress, `${file.label} - 读取失败`, '');
                    continue;
                }

                const { data } = parseRBCSV(csvText);
                const typedData = convertRBData(file.schemaKey, data);
                await importRBData(file.store, typedData);
                importResults[file.schemaKey] = true;
                successCount++;
                updateProgress(progress, `${file.label} - 导入成功`, `${typedData.length}条`);
                
            } catch (error) {
                console.error(`处理 ${file.name} 失败:`, error);
                failCount++;
                importResults[file.schemaKey] = false;
            }
        }

        // 读取 weights.json（离线重量数据，供称重计算优先使用）
        let weightsCount = 0;
        try {
            updateProgress(0.7, '读取重量数据...', 'weights.json');
            const weightsText = await fetchRBFile('weights.json');
            if (weightsText) {
                const result = await importWeightsFromJSON(JSON.parse(weightsText));
                weightsCount = result.success ? result.count : 0;
                importResults['weights'] = result.success;
                updateProgress(0.8, `重量数据 - ${result.success ? '导入成功' : '导入失败'}`, `${weightsCount}条`);
            } else {
                importResults['weights'] = false;
            }
        } catch (error) {
            console.error('处理 weights.json 失败:', error);
            importResults['weights'] = false;
        }

        // 显示结果
        updateProgress(1, '更新完成！', '');

        const stats = await getRBStats();
        let statsHtml = '';
        if (stats) {
            statsHtml = '<div style="font-size: 12px; color: #666; margin: 10px 0;">';
            statsHtml += `<div>颜色: ${stats.rb_colors || 0} 条</div>`;
            statsHtml += `<div>零件: ${stats.rb_parts || 0} 条</div>`;
            statsHtml += `<div>类别: ${stats.rb_part_categories || 0} 条</div>`;
            statsHtml += `<div>元素: ${stats.rb_elements || 0} 条</div>`;
            statsHtml += `<div>库存: ${stats.rb_inventory_parts || 0} 条</div>`;
            statsHtml += `<div>关系: ${stats.rb_part_relationships || 0} 条</div>`;
            statsHtml += `<div>重量: ${stats.rb_weights || 0} 条</div>`;
            statsHtml += '</div>';
        }

        setTimeout(() => {
            const resultDiv = document.getElementById('rb-result');
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `
                <div style="padding: 15px; margin-top: 10px;">
                    <div style="font-size: 16px; margin-bottom: 10px;">
                        ${failCount === 0 ? '✓ 更新成功' : `⚠ 成功 ${successCount} 个，失败 ${failCount} 个`}
                    </div>
                    ${statsHtml}
                    <button class="btn-save" style="margin-top: 15px;" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                </div>
            `;
            showRBStatusHint('rb-ready');
        }, 500);
        
    } catch (error) {
        console.error('更新RB失败:', error);
        updateProgress(1, '更新失败', error.message);
        
        setTimeout(() => {
            const resultDiv = document.getElementById('rb-result');
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `
                <div style="padding: 15px; margin-top: 10px; color: #f44336;">
                    <div style="font-size: 16px; margin-bottom: 10px;">✗ 更新失败</div>
                    <div style="font-size: 12px; margin: 10px 0;">${error.message}</div>
                    <button class="btn-save" style="margin-top: 15px;" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                </div>
            `;
        }, 500);
    }
}

// 导出 RB 数据库到文件
async function exportRB() {
    if (!confirm('确定要导出 RB 数据库吗？\n将保存为 JSON 文件到"文件"App。')) {
        return;
    }

    try {
        const jsonData = await exportRBDatabaseToJSON();
        
        // 显示进度
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 350px; text-align: center;">
                <div class="modal-header">
                    <span class="modal-title">导出RB数据库</span>
                </div>
                <div class="modal-body">
                    <div style="padding: 20px;">
                        <div style="font-size: 14px; color: #666;">正在导出...</div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        // 创建下载
        const blob = new Blob([JSON.stringify(jsonData)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        a.download = `rb_database_${timestamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 500);
        
        // 显示成功
        setTimeout(() => {
            overlay.querySelector('.modal-body').innerHTML = `
                <div style="padding: 20px;">
                    <div style="font-size: 16px; margin-bottom: 10px;">✓ 导出成功</div>
                    <div style="font-size: 12px; color: #666; margin-bottom: 8px;">
                        文件已保存到"文件"App
                    </div>
                    <button class="btn-save" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                </div>
            `;
        }, 300);
        
    } catch (error) {
        console.error('导出RB失败:', error);
        alert('导出失败: ' + error.message);
    }
}

async function loadStats() {
    try {
        const repos = await getRepositories();
        document.getElementById('stat-repos').textContent = repos.length;
        
        let totalBoxes = 0;
        let totalParts = 0;
        let totalQuantity = 0;
        
        for (const repo of repos) {
            const boxes = await getBoxes(repo.id);
            totalBoxes += boxes.length;
            
            for (const box of boxes) {
                const parts = await getParts(box.id);
                totalParts += parts.length;
                totalQuantity += parts.reduce((sum, p) => sum + (p.quantity || 0), 0);
            }
        }
        
        document.getElementById('stat-boxes').textContent = totalBoxes;
        document.getElementById('stat-parts').textContent = totalParts;
        document.getElementById('stat-total-qty').textContent = totalQuantity;
    } catch (error) {
        console.error('加载统计信息失败:', error);
    }
}

// 将函数暴露到全局
window.updateRB = updateRB;
window.exportRB = exportRB;

// ===== 密码轮 =====
const PW_PASSWORD = '22332468';

const pwWheelState = {
    overlay: null,
    rounds: 1,
    round: 1,
    currentInput: '',
    onSuccess: null,
    onCancel: null,
    roundMessages: [],
    settingsUnlocked: false
};

// 在屏幕底部显示密码轮
function showPasswordWheel({ rounds = 1, messages = [], onSuccess, onCancel } = {}) {
    // 关闭可能存在的旧密码轮
    hidePasswordWheel();

    pwWheelState.rounds = Math.max(1, rounds);
    pwWheelState.round = 1;
    pwWheelState.currentInput = '';
    pwWheelState.onSuccess = onSuccess || null;
    pwWheelState.onCancel = onCancel || null;
    pwWheelState.roundMessages = messages || [];

    const overlay = document.createElement('div');
    overlay.className = 'pw-wheel-overlay';

    const panel = document.createElement('div');
    panel.className = 'pw-wheel-panel';

    // 顶部：左取消 + 右回退
    const topbar = document.createElement('div');
    topbar.className = 'pw-wheel-topbar';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'pw-wheel-cancel';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', cancelPwWheel);
    const backspaceBtn = document.createElement('button');
    backspaceBtn.className = 'pw-wheel-backspace';
    backspaceBtn.textContent = '回退';
    backspaceBtn.addEventListener('click', backspacePwDigit);
    topbar.appendChild(cancelBtn);
    topbar.appendChild(backspaceBtn);

    // 显示区：提示 + 圆点 + 错误
    const display = document.createElement('div');
    display.className = 'pw-wheel-display';
    const hint = document.createElement('p');
    hint.className = 'pw-wheel-hint';
    hint.id = 'pw-wheel-hint';
    const dots = document.createElement('div');
    dots.className = 'pw-wheel-dots';
    dots.id = 'pw-wheel-dots';
    const error = document.createElement('p');
    error.className = 'pw-wheel-error';
    error.id = 'pw-wheel-error';
    display.appendChild(hint);
    display.appendChild(dots);
    display.appendChild(error);

    // 数字圆盘：0-9 以半径110px顺时针分布，0在正上方
    const stage = document.createElement('div');
    stage.className = 'pw-wheel-stage';
    const cx = 133, cy = 133, r = 110;
    for (let i = 0; i < 10; i++) {
        const angle = (-90 + i * 36) * Math.PI / 180;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pw-wheel-number-btn';
        btn.textContent = i;
        btn.style.left = x + 'px';
        btn.style.top = y + 'px';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            appendPwDigit(i);
        });
        stage.appendChild(btn);
    }

    // 圆心：确认按钮
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'pw-wheel-confirm-btn';
    confirmBtn.textContent = '确认';
    confirmBtn.addEventListener('click', (e) => {
        e.preventDefault();
        confirmPwRound();
    });
    stage.appendChild(confirmBtn);

    panel.appendChild(topbar);
    panel.appendChild(display);
    panel.appendChild(stage);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    pwWheelState.overlay = overlay;

    // 监听物理键盘（数字/回退/确认/取消）
    document.addEventListener('keydown', pwWheelKeyHandler);

    updatePwWheelDisplay();
}

function pwWheelKeyHandler(e) {
    if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        appendPwDigit(parseInt(e.key, 10));
    } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspacePwDigit();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        confirmPwRound();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelPwWheel();
    }
}

function appendPwDigit(d) {
    if (pwWheelState.currentInput.length >= PW_PASSWORD.length) {
        return;
    }
    pwWheelState.currentInput += String(d);
    updatePwWheelDisplay();
}

function backspacePwDigit() {
    pwWheelState.currentInput = pwWheelState.currentInput.slice(0, -1);
    updatePwWheelDisplay();
}

function updatePwWheelDisplay() {
    if (!pwWheelState.overlay) return;
    const dots = document.getElementById('pw-wheel-dots');
    const hint = document.getElementById('pw-wheel-hint');
    const error = document.getElementById('pw-wheel-error');
    if (dots) dots.textContent = '●'.repeat(pwWheelState.currentInput.length);
    if (error) error.textContent = '';
    if (hint) {
        const msg = pwWheelState.roundMessages[pwWheelState.round - 1];
        if (msg) {
            hint.textContent = msg;
        } else if (pwWheelState.rounds > 1) {
            hint.textContent = `请输入密码（第 ${pwWheelState.round}/${pwWheelState.rounds} 次）`;
        } else {
            hint.textContent = '请输入密码';
        }
    }
}

function confirmPwRound() {
    if (pwWheelState.currentInput !== PW_PASSWORD) {
        const error = document.getElementById('pw-wheel-error');
        if (error) error.textContent = '密码错误，请重新输入';
        pwWheelState.currentInput = '';
        updatePwWheelDisplay();
        return;
    }
    if (pwWheelState.round >= pwWheelState.rounds) {
        const onSuccess = pwWheelState.onSuccess;
        hidePasswordWheel();
        if (onSuccess) onSuccess();
    } else {
        pwWheelState.round++;
        pwWheelState.currentInput = '';
        updatePwWheelDisplay();
    }
}

function cancelPwWheel() {
    const onCancel = pwWheelState.onCancel;
    hidePasswordWheel();
    if (onCancel) onCancel();
}

function hidePasswordWheel() {
    document.removeEventListener('keydown', pwWheelKeyHandler);
    if (pwWheelState.overlay) {
        pwWheelState.overlay.remove();
        pwWheelState.overlay = null;
    }
}

// 将密码轮相关函数暴露到全局
window.showPasswordWheel = showPasswordWheel;
window.cancelPwWheel = cancelPwWheel;