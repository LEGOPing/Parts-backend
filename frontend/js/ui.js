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
        
        const fragment = document.createDocumentFragment();
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
            
            fragment.appendChild(card);
        });
        // 一次性原子替换，避免清空后异步填充造成的空窗闪烁和页面跳动
        list.innerHTML = '';
        list.appendChild(fragment);
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
    const fragment = document.createDocumentFragment();
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
        
        fragment.appendChild(card);
    });
    // 一次性原子替换，避免清空后异步填充造成的空窗闪烁和页面跳动
    grid.innerHTML = '';
    grid.appendChild(fragment);
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
    
    // 先并行解析所有零件图片URL（避免逐个 await 串行，极大提升页面刷新速度）
    const partsWithUrl = await Promise.all(parts.map(async (part) => ({
        part,
        imgUrl: await getPartImageUrl(part.part_num, part.color_id)
    })));
    
    for (const { part, imgUrl } of partsWithUrl) {
        const card = document.createElement('div');
        card.className = 'part-card';
        card.dataset.id = part.id;
        
        const color = colorMap[part.color_id];
        const colorName = color ? color.name : '未知颜色';
        // 转义型号中的单引号/反斜杠，避免破坏 onload 内联属性
        const partNumEsc = String(part.part_num).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        
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
        
        const imageContainer = card.querySelector('.part-image');
        if (imgUrl) {
            // onload 成功即写入离线缓存（Gitee/RB 都满足：首次加载的图片进入离线缓存区）
            const escapedUrl = imgUrl.replace(/"/g, '&quot;');
            imageContainer.innerHTML = `<img src="${escapedUrl}" alt="${part.name}"
                onload="autoCachePartImage('${partNumEsc}', ${part.color_id}, this)"
                onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=no-image>暂无图片</div>'">`;
        } else {
            imageContainer.innerHTML = '<div class="no-image">暂无图片</div>';
        }
        
        card.addEventListener('click', () => {
            showPartDetail(part);
        });
        
        list.appendChild(card);
    }
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
                <div class="pt-row pt-box-row">
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

    // 先并行解析图片URL，避免串行等待拖慢弹窗渲染
    const partsWithUrl = await Promise.all(parts.map(async (part) => ({
        part,
        imgUrl: await getPartImageUrl(part.part_num, part.color_id)
    })));
    
    for (const { part, imgUrl } of partsWithUrl) {
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
        const imgBox = card.querySelector('.pt-part-image');
        if (imgUrl) {
            const partNumEsc = String(part.part_num).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const escapedUrl = imgUrl.replace(/"/g, '&quot;');
            imgBox.innerHTML = `<img src="${escapedUrl}" alt="${part.name}"
                onload="autoCachePartImage('${partNumEsc}', ${part.color_id}, this)"
                onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=no-image>暂无图片</div>'">`;
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

function updateSearchResultStatus(partId, isNew) {
    const card = document.querySelector(`.search-result-card[data-part-id="${partId}"]`);
    if (!card) return;
    const statusEl = card.querySelector('.src-status');
    if (!statusEl) return;
    const text = isNew ? '新' : '旧';
    statusEl.textContent = text;
    statusEl.title = isNew ? '新品' : '旧品';
    statusEl.className = 'src-status ' + (isNew ? 'new' : 'used');
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
                    <button type="button" class="btn-recognize" onclick="showRecognizeModal()">识别</button>
                </div>
                <div class="data-source-hint" id="data-source-hint"></div>
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
                <div class="color-count-hint" id="color-count-hint"></div>
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
            <div class="form-section">
                <div class="form-row">
                    <label class="form-label">零件图片：</label>
                    <div class="part-image-preview" id="add-part-image-preview">
                        <div class="no-image">暂无图片</div>
                    </div>
                </div>
            </div>
            <div id="add-part-error" style="color: red; font-size: 12px; display: none; padding: 10px; background: rgba(255, 0, 0, 0.1); border-radius: 4px;"></div>
        </div>
    `;
    
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    
    window.newPartIsNew = true;
    
    // 初始化联想功能
    initAddPartSuggestions();
}

// ==================== 拍照识别弹窗（独立于添加零件表单）====================

// 拍照识别结果暂存
let recognizeResultData = { partNum: '', partName: '', colorId: '', colorName: '' };
// 标记本次识别是否由「兑底匹配（方法一/方法二）」确定了零件颜色，
// 用于防止后续 BG 默认颜色覆盖该方法选定的颜色。
let recognizeFallbackSetColor = false;

// 打开拍照识别弹窗
function showRecognizeModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'recognize-modal-overlay';
    
    const sheet = document.createElement('div');
    sheet.className = 'modal-content add-part-modal';
    
    const isCalibrated = isGrayCardCalibrated();
    
    sheet.innerHTML = `
        <div class="modal-header">
            <button class="btn-cancel" onclick="closeRecognizeModal(true)">取消</button>
            <span class="modal-title">拍照识别</span>
            <button class="btn-save" id="recognize-confirm-btn" style="opacity:0.4;pointer-events:none;" onclick="confirmRecognizeResult()">确认</button>
        </div>
        <div class="modal-body">
            <!-- 区域二：拍照识别按钮 + 灰卡白平衡校准 -->
            <div class="recognize-area2">
                <div class="area2-left">
                    <div class="area2-header">
                        <span class="area2-label">灰板白平衡校准</span>
                        <span class="gray-card-status-text ${isCalibrated ? 'calibrated' : 'uncalibrated'}" id="gray-card-status-text">
                            ${isCalibrated ? '✓ 已校准' : '未校准'}
                        </span>
                    </div>
                    <div class="area2-scroll-wrap" id="gray-card-instruction">
                        <div class="area2-scroll-text">
                            ${isCalibrated
                                ? '灰卡白平衡已校准，点击"校准"可重新校准'
                                : '将 18% 灰卡放在零件拍摄位置，点击"校准"拍照'}
                        </div>
                    </div>
                    <div class="area2-actions">
                        <button type="button" class="btn-gray-card-reset" onclick="resetGrayCardCalibrationUI()" ${isCalibrated ? '' : 'style="display:none"'} id="gray-card-clear-btn">清除</button>
                        <button type="button" class="btn-gray-card" onclick="calibrateGrayCard()">校准</button>
                    </div>
                </div>
                <div class="area2-right">
                    <button type="button" class="recognize-circle-btn" onclick="recognizePartFromPhoto()" title="拍照识别零件">
                        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                        </svg>
                    </button>
                </div>
            </div>
            
            <!-- 区域三：识别结果预览区（始终显示，识别后填充内容） -->
            <div class="recognize-preview-section" id="recognize-preview-section">
                <div class="preview-section-title">BG识别结果预览</div>
                <div class="preview-part-card" id="preview-part-card">
                    <div class="preview-part-image" id="preview-part-image">
                        <div class="no-image">暂无图片</div>
                    </div>
                    <div class="preview-part-details">
                        <div class="preview-detail-row">
                            <span class="preview-detail-label">型号：</span>
                            <span class="preview-detail-value" id="recognize-part-num-display"></span>
                        </div>
                        <div class="preview-detail-row">
                            <span class="preview-detail-label">名称：</span>
                            <span class="preview-detail-value" id="recognize-part-name-display"></span>
                        </div>
                        <div class="preview-detail-row">
                            <span class="preview-detail-label">颜色：</span>
                            <span class="preview-detail-value" id="recognize-color-display"></span>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- 区域四：颜色预选区（始终显示，识别后填充内容） -->
            <div class="color-preselection" id="color-preselection">
                <div class="preview-section-title">颜色预选</div>
                <div class="color-preselect-list" id="color-preselect-list">
                    <div style="padding:12px;text-align:center;color:#999;font-size:13px;">拍照识别后将显示推荐颜色</div>
                </div>
            </div>
            
            <!-- 隐藏的识别结果区域（用于动态渲染） -->
            <div class="recognize-result" id="recognize-result" style="display:none;"></div>
        </div>
    `;
    
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    
    // 隐藏相机输入
    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.id = 'recognize-camera-input';
    cameraInput.accept = 'image/*';
    cameraInput.style.display = 'none';
    cameraInput.addEventListener('change', () => processRecognitionFile(cameraInput));
    document.body.appendChild(cameraInput);
    
    // 灰卡校准专用文件输入（隐藏）
    const grayCardInput = document.createElement('input');
    grayCardInput.type = 'file';
    grayCardInput.id = 'gray-card-camera-input';
    grayCardInput.accept = 'image/*';
    grayCardInput.capture = 'environment';
    grayCardInput.style.display = 'none';
    grayCardInput.addEventListener('change', () => processGrayCardFile(grayCardInput));
    document.body.appendChild(grayCardInput);
    
    // 重置识别结果
    recognizeResultData = { partNum: '', partName: '', colorId: '', colorName: '' };
}

// 关闭识别弹窗
function closeRecognizeModal(cancel) {
    // 清理相机输入
    const input = document.getElementById('recognize-camera-input');
    if (input) input.remove();
    const grayInput = document.getElementById('gray-card-camera-input');
    if (grayInput) grayInput.remove();
    
    const overlay = document.getElementById('recognize-modal-overlay');
    if (overlay) overlay.remove();
    
    if (cancel) {
        // 取消则不保留任何结果
        recognizeResultData = { partNum: '', partName: '', colorId: '', colorName: '' };
    }
}

// 确认识别结果，填入添加零件表单
function confirmRecognizeResult() {
    const data = recognizeResultData;
    if (!data.partNum) return;
    
    const numInput = document.getElementById('new-part-num');
    const nameInput = document.getElementById('new-part-name');
    const colorInput = document.getElementById('new-part-color');
    
    if (numInput) numInput.value = data.partNum;
    if (nameInput) nameInput.value = data.partName;
    if (colorInput) {
        colorInput.value = data.colorId;
        updateColorButtonColor(data.colorId);
    }
    
    closeRecognizeModal(false);
    
    // 触发颜色输入事件以更新零件图片预览
    if (colorInput) {
        colorInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

// 更新识别弹窗预览区域，启用/禁用确认按钮
function updateRecognizePreview() {
    const data = recognizeResultData;
    const numDisplay = document.getElementById('recognize-part-num-display');
    const nameDisplay = document.getElementById('recognize-part-name-display');
    const colorDisplay = document.getElementById('recognize-color-display');
    const previewSection = document.getElementById('recognize-preview-section');
    const confirmBtn = document.getElementById('recognize-confirm-btn');
    
    if (numDisplay) numDisplay.textContent = data.partNum || '-';
    if (nameDisplay) nameDisplay.textContent = data.partName || '-';
    if (colorDisplay) {
        colorDisplay.textContent = data.colorName ? `${data.colorName} (ID: ${data.colorId})` : (data.colorId ? `ID: ${data.colorId}` : '-');
    }
    
    // 有识别结果时显示预览区域并启用确认按钮
    if (data.partNum) {
        if (previewSection) previewSection.style.display = 'block';
        if (confirmBtn) {
            confirmBtn.style.opacity = '1';
            confirmBtn.style.pointerEvents = 'auto';
        }
    }
}

// 初始化添加零件的联想功能
function initAddPartSuggestions() {
    const partNumInput = document.getElementById('new-part-num');
    const partNameInput = document.getElementById('new-part-name');
    const partNumSuggestions = document.getElementById('part-number-suggestions');
    const partNameSuggestions = document.getElementById('part-name-suggestions');
    const partNameHint = document.getElementById('part-name-hint');
    
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
        
        // 如果直接搜索无结果，尝试通过别名查找
        let aliasSuggestions = [];
        if (suggestions.length === 0) {
            const resolvedNum = await resolvePartAlias(query.trim());
            if (resolvedNum && resolvedNum !== query.trim()) {
                aliasSuggestions = await searchPartsByNumber(resolvedNum, 5);
                // 标记为别名推荐
                aliasSuggestions = aliasSuggestions.map(s => ({
                    ...s,
                    part_num: s.part_num,
                    name: s.name,
                    aliasFrom: query.trim()
                }));
            }
        }
        
        const allSuggestions = [...suggestions, ...aliasSuggestions];
        
        if (allSuggestions.length === 0) {
            hidePartNumSuggestions();
            return;
        }
        
        partNumSuggestions.innerHTML = allSuggestions.map(s => `
            <div class="part-number-suggestion-item ${s.aliasFrom ? 'alias-suggestion' : ''}" data-part-num="${s.part_num}" data-part-name="${s.name}" data-alias-from="${s.aliasFrom || ''}">
                <span class="suggestion-num">${s.part_num}</span>
                <span class="suggestion-name">${s.name}${s.aliasFrom ? ` (别名: ${s.aliasFrom})` : ''}</span>
            </div>
        `).join('');
        partNumSuggestions.style.display = 'block';
        
        // 绑定点击事件
        partNumSuggestions.querySelectorAll('.part-number-suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const partNum = item.dataset.partNum;
                const partName = item.dataset.partName;
                const aliasFrom = item.dataset.aliasFrom;
                
                // 如果是别名推荐，填写原始型号，但显示数据来源提示
                if (aliasFrom) {
                    partNumInput.value = aliasFrom;
                    const dsHint = document.getElementById('data-source-hint');
                    if (dsHint) {
                        dsHint.textContent = `数据来源：${partNum}`;
                    }
                } else {
                    partNumInput.value = partNum;
                }
                hidePartNumSuggestions();
                
                if (partName) {
                    partNameInput.value = partName;
                    if (!aliasFrom) {
                        partNameHint.textContent = '';
                    }
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
    
    // 根据型号更新颜色数量提示
    async function updatePartInfoPreview() {
        const partNum = partNumInput.value.trim();
        const hintEl = document.getElementById('color-count-hint');
        if (!hintEl) return;

        if (!partNum) {
            hintEl.textContent = '';
            updateAddPartImage();
            return;
        }

        let effectivePartNum = partNum;

        // 如果在 RB 中找不到，尝试通过别名解析
        let part = await getPartByNum(partNum);
        if (!part) {
            const resolvedNum = await resolvePartAlias(partNum);
            if (resolvedNum && resolvedNum !== partNum) {
                effectivePartNum = resolvedNum;
                part = await getPartByNum(resolvedNum);
            }
        }

        // 更新数据来源提示
        const dsHint = document.getElementById('data-source-hint');
        if (dsHint) {
            if (effectivePartNum !== partNum) {
                dsHint.innerHTML = `数据来源：${effectivePartNum}`;
            } else if (!part) {
                // 直接匹配和别名都失败时，显示 BL 匹配按钮
                dsHint.innerHTML = 'RB未匹配 <button class="btn-bl-match" onclick="triggerBLMatchForManual()">BL</button>';
            } else {
                dsHint.textContent = '';
            }
        }

        if (part) {
            if (!partNameInput.value) {
                partNameInput.value = part.name || '';
            }

            const colorCount = await getPartColorCount(effectivePartNum);
            hintEl.textContent = colorCount > 0 ? `可能有${colorCount}种颜色` : '';
        } else {
            hintEl.textContent = '';
        }
        updateAddPartImage();
    }
    
    // 更新添加零件页的图片预览行
    async function updateAddPartImage() {
        const partNum = partNumInput.value.trim();
        const colorId = document.getElementById('new-part-color')?.value.trim() || '';
        const imagePreview = document.getElementById('add-part-image-preview');
        if (!imagePreview) return;
        
        if (partNum && colorId) {
            const imgUrl = await getPartImageUrl(partNum, colorId);
            if (imgUrl) {
                imagePreview.innerHTML = `<img src="${imgUrl}" alt="${partNum}" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=no-image>暂无图片</div>'">`;
                return;
            }
        }
        imagePreview.innerHTML = '<div class="no-image">暂无图片</div>';
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
            const dsHint = document.getElementById('data-source-hint');
            if (dsHint) dsHint.textContent = '';
            document.getElementById('color-count-hint') && (document.getElementById('color-count-hint').textContent = '');
            updateAddPartImage();
            return;
        }
        
        if (value.length > 10) {
            hidePartNumSuggestions();
            return;
        }
        
        // 延迟触发联想查询（不自动选择）
        partNumTimer = setTimeout(async () => {
            await showPartNumSuggestions(value);
            await updatePartInfoPreview();
            await updateAddPartImage();
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
    
    // 颜色输入变化时更新预览（切换颜色图片）
    const colorInput = document.getElementById('new-part-color');
    colorInput.addEventListener('input', () => {
        updatePartInfoPreview();
        updateAddPartImage();
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

// 重置识别 UI（第二次拍摄时清除之前的结果，但保持区域可见）
function resetRecognizeUI() {
    recognizeResultData = { partNum: '', partName: '', colorId: '', colorName: '' };
    recognizeFallbackSetColor = false;
    
    // 保持区域三（预览区）可见，清除内容
    const previewImg = document.getElementById('preview-part-image');
    if (previewImg) previewImg.innerHTML = '<div class="no-image">暂无图片</div>';
    
    // 清除预览文字
    const numDisplay = document.getElementById('recognize-part-num-display');
    const nameDisplay = document.getElementById('recognize-part-name-display');
    const colorDisplay = document.getElementById('recognize-color-display');
    if (numDisplay) numDisplay.textContent = '';
    if (nameDisplay) nameDisplay.textContent = '';
    if (colorDisplay) colorDisplay.textContent = '';
    
    // 保持区域四（颜色预选）可见，显示占位文字
    const colorList = document.getElementById('color-preselect-list');
    if (colorList) colorList.innerHTML = '<div style="padding:12px;text-align:center;color:#999;font-size:13px;">拍照识别后将显示推荐颜色</div>';
    
    // 禁用确认按钮
    const confirmBtn = document.getElementById('recognize-confirm-btn');
    if (confirmBtn) {
        confirmBtn.style.opacity = '0.4';
        confirmBtn.style.pointerEvents = 'none';
    }
    
    // 清除别名提示和同名零件选择器
    const aliasHint = document.querySelector('.alias-hint');
    if (aliasHint) aliasHint.remove();
    const sameNamePicker = document.getElementById('same-name-parts-picker');
    if (sameNamePicker) sameNamePicker.remove();
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
    
    // 重置之前的识别结果
    resetRecognizeUI();
    
    setRecognizeStatus('正在处理图片...');

    try {
        // 压缩图片（缩小尺寸、转 JPEG），避免API因文件太大或格式不支持返回422
        const compressed = await compressImage(file, 1024);
        if (!compressed) { setRecognizeStatus('图片处理失败'); return; }

        // 裁剪到零件最小包围框（去除多余背景，提升识别精度和颜色分析准确度）
        const cropped = await cropToPart(compressed);

        // 本地预览裁剪后的图片（放入 Area 3 预览卡片）
        const previewUrl = URL.createObjectURL(cropped);
        const previewImgContainer = document.getElementById('preview-part-image');
        if (previewImgContainer) {
            previewImgContainer.innerHTML = `<img class="recognize-thumb" src="${previewUrl}" alt="预览图片" />`;
        }

        setRecognizeStatus('正在上传识别中，请稍候...');
        const candidate = await uploadToBrickognize(cropped);
        URL.revokeObjectURL(previewUrl);
        if (!candidate) { setRecognizeStatus('未识别到零件，请重试'); return; }

        // 填入零件信息（支持别名解析与兑底匹配），获取有效的RB零件型号
        const effectivePartNum = await fillRecognizedPart(candidate.id, candidate.name, candidate.colorName);

        // 颜色处理：优先使用 BG 返回的颜色，其次通过图片分析计算
        let bgColorId = candidate.colorId;
        let bgColorName = candidate.colorName;

        // 计算裁剪后的图片中最接近的 RB 颜色（同时作为备选，背景已去除，颜色分析更准确）
        const result = await computeClosestRBColors(cropped, effectivePartNum || candidate.id);

        // 确保 BG 颜色始终在颜色列表中（不在最近5个中就将其加入）
        if (bgColorId !== null && bgColorId !== undefined) {
            const bgInColors = result.colors.findIndex(c => c.id === Number(bgColorId));
            if (bgInColors === -1) {
                const allColors = await getAllColors();
                const bgColor = allColors.find(c => c.id === Number(bgColorId));
                if (bgColor) {
                    result.colors.unshift({
                        id: bgColor.id,
                        name: bgColor.name,
                        hex: bgColor.rgb
                    });
                }
            }
        }
        renderRecognizeColors(result.colors, result.dominantHex, bgColorId, bgColorName);

        // 识别完成后隐藏状态区域，显示预览和颜色预选
        const statusBox = document.getElementById('recognize-result');
        if (statusBox) statusBox.style.display = 'none';

        // 如果 BG 返回了颜色，自动选中（存入暂存数据）
        // 注意：若兑底匹配已确定更精确的颜色（recognizeFallbackSetColor），则优先保留该颜色
        if (!recognizeFallbackSetColor && bgColorId !== null && bgColorId !== undefined) {
            recognizeResultData.colorId = String(bgColorId);
            recognizeResultData.colorName = bgColorName || '';
            updateRecognizePreview();
        }

        // 同名零件消歧：如果名称不为空，查询 RB 数据库中所有同名零件
        const partName = recognizeResultData.partName;
        if (partName && effectivePartNum) {
            await showSameNamePartsPicker(partName, effectivePartNum);
        }
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

// 裁剪图片到零件的最小包围框（去除多余背景）
// 返回裁剪后的 File，如果无法裁剪则返回原图
async function cropToPart(file) {
    const img = await fileToImage(file);
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (nw < 50 || nh < 50) return file;

    // 缩小到 256px 分析
    const scale = Math.min(256 / nw, 256 / nh, 1);
    const aw = Math.round(nw * scale), ah = Math.round(nh * scale);
    const canvas = document.createElement('canvas');
    canvas.width = aw;
    canvas.height = ah;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, aw, ah);
    let data;
    try { data = ctx.getImageData(0, 0, aw, ah).data; } catch (e) { return file; }

    // 从四个角采样背景色（取各角 10% 区域）
    const cornerSize = 0.10;
    let bgSamples = [];
    const corners = [
        [0, 0], [aw - Math.round(aw * cornerSize), 0],
        [0, ah - Math.round(ah * cornerSize)], [aw - Math.round(aw * cornerSize), ah - Math.round(ah * cornerSize)]
    ];
    for (const [cx, cy] of corners) {
        const cw = Math.round(aw * cornerSize), ch = Math.round(ah * cornerSize);
        for (let y = cy; y < cy + ch && y < ah; y++) {
            for (let x = cx; x < cx + cw && x < aw; x++) {
                const i = (y * aw + x) * 4;
                bgSamples.push([data[i], data[i + 1], data[i + 2]]);
            }
        }
    }
    if (bgSamples.length < 50) return file;

    // 计算背景平均色
    let sumR = 0, sumG = 0, sumB = 0;
    for (const p of bgSamples) { sumR += p[0]; sumG += p[1]; sumB += p[2]; }
    const bgR = sumR / bgSamples.length, bgG = sumG / bgSamples.length, bgB = sumB / bgSamples.length;
    const bgBright = (bgR + bgG + bgB) / 3;
    // 降低阈值，更敏感地检测前景（零件）像素，尤其对小零件和颜色接近背景的零件
    let threshold = Math.max(12, Math.min(30, Math.round(bgBright / 15)));
    let threshold2 = threshold * threshold;

    // 扫描前景像素，找最小包围框（最多尝试两次，第二次降低阈值）
    let minX = aw, minY = ah, maxX = 0, maxY = 0;
    let fgCount = 0;
    let retried = false;
    for (let pass = 0; pass < 2; pass++) {
        minX = aw; minY = ah; maxX = 0; maxY = 0; fgCount = 0;
        // 步长 2（隔行扫描加速）
        for (let y = 0; y < ah; y += 2) {
            for (let x = 0; x < aw; x += 2) {
                const i = (y * aw + x) * 4;
                const dr = data[i] - bgR, dg = data[i + 1] - bgG, db = data[i + 2] - bgB;
                if (dr * dr + dg * dg + db * db > threshold2) {
                    fgCount++;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        const totalPixels = (aw / 2) * (ah / 2);
        // 前景足够多，直接跳出（降低要求，0.5% 即可）
        if (fgCount >= totalPixels * 0.005) break;
        // 第一次前景太少，降低阈值重试
        if (pass === 0) {
            retried = true;
            threshold = Math.max(8, Math.round(threshold * 0.6));
            threshold2 = threshold * threshold;
        }
    }

    // 如果两次扫描后仍无前景，用中心裁剪法（假设零件在画面中央）
    const totalPixels = (aw / 2) * (ah / 2);
    if (fgCount < totalPixels * 0.005) {
        // 中心裁剪：取画面较短边的 80% 作为正方形（尽可能多包含零件）
        const centerSize = Math.min(aw, ah) * 0.8;
        minX = Math.round((aw - centerSize) / 2);
        minY = Math.round((ah - centerSize) / 2);
        maxX = Math.round(minX + centerSize);
        maxY = Math.round(minY + centerSize);
    }

    // 裁剪为正方形：以零件中心为中心，边长取较长边（仅留少量边距）
    const pad = 0.04; // 减小边距，让零件占容器约 92% 尺寸
    // 在原图坐标系中计算零件包围框
    let partCX = (minX + maxX) / 2 / scale;
    let partCY = (minY + maxY) / 2 / scale;
    let partW = (maxX - minX) / scale;
    let partH = (maxY - minY) / scale;
    // 正方形边长 = 较长边 + 两侧边距
    let side = Math.max(partW, partH) * (1 + pad * 2);
    // 居中裁剪
    let cropX = Math.round(partCX - side / 2);
    let cropY = Math.round(partCY - side / 2);
    let cropSize = Math.round(side);
    // 超出边界保护：正方形不能超过图片范围
    if (cropSize > nw || cropSize > nh) {
        // 裁剪尺寸超过图片——缩小到图片较短边
        cropSize = Math.min(nw, nh);
        cropX = Math.round(partCX - cropSize / 2);
        cropY = Math.round(partCY - cropSize / 2);
    }
    // 平移保证在图片内
    cropX = Math.max(0, Math.min(cropX, nw - cropSize));
    cropY = Math.max(0, Math.min(cropY, nh - cropSize));
    if (cropSize < 30) return file;

    // 执行正方形裁剪
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropSize;
    cropCanvas.height = cropSize;
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) return file;
    cropCtx.drawImage(img, cropX, cropY, cropSize, cropSize, 0, 0, cropSize, cropSize);
    return new Promise((resolve) => {
        cropCanvas.toBlob((blob) => {
            if (!blob) { resolve(file); return; }
            resolve(new File([blob], 'recognize_cropped.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.92);
    });
}

// 调用 Brickognize 识别零件型号和颜色
// 启用颜色预测（predict_color=true），返回结果包含：
// - id: 零件型号
// - name: 零件名称
// - colorName: 识别到的颜色名称（如 "Red"）
// - colorId: 匹配到的 RB 颜色 ID（通过颜色名称匹配）
async function uploadToBrickognize(file) {
    const formData = new FormData();
    formData.append('query_image', file);
    const url = 'https://api.brickognize.com/predict/parts/?predict_color=true&top_k_items=3&min_similarity_items=0';
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

    // 解析颜色信息：Brickognize 返回的颜色名称
    let colorName = '';
    let colorId = null;
    if (data.predicted_color) {
        colorName = String(data.predicted_color).trim();
    } else if (cand.color) {
        colorName = String(cand.color).trim();
    }

    // 尝试将颜色名称匹配到 RB 颜色 ID
    if (colorName) {
        try {
            const matchedColor = await matchColorNameToId(colorName);
            if (matchedColor) {
                colorId = matchedColor.id;
                colorName = matchedColor.name;
            }
        } catch (e) {
            console.warn('颜色名称匹配失败:', e.message);
        }
    }

    return {
        id: String(cand.id),
        name: cand.name || '',
        colorName: colorName,
        colorId: colorId
    };
}

// —— 以下为「兑底匹配」辅助函数（场景 A/B 均匹配不到 RB 型号时使用）——
// 场景 A：BG 型号能直接匹配 rb_parts 的 part_num
// 场景 B：BG 型号通过别名表（resolvePartAlias）映射到 RB 标准型号
// 当 A/B 都失败时依次尝试：
//   方法一：BG型号 + 颜色名 在 RB 数据中等价匹配（BL 匹配的近似实现，返回标准 part_num + color_id）
//   方法二：按 BG 名称精确度排序提供至多 10 个候选零件，由用户人工选择

// 名称相似度评分（用于方法二候选排序与过滤）
function _nameSimilarityScore(query, candidate) {
    const q = String(query || '').toLowerCase().trim();
    const c = String(candidate || '').toLowerCase().trim();
    if (!c || !q) return -1;
    if (c === q) return 100;                        // 完全一致
    if (c.startsWith(q)) return 80;                 // 名称以关键词开头
    if (q.startsWith(c)) return 70;                 // 关键词以名称为开头
    const qWords = q.split(/\s+/).filter(Boolean);
    const cWords = c.split(/\s+/).filter(Boolean);
    if (!qWords.length || !cWords.length) return 0;
    let hit = 0;
    for (const w of qWords) {
        if (cWords.some(cw => cw.includes(w) || w.includes(cw))) hit++;
    }
    let score = (hit / qWords.length) * 60;         // 分词命中比例
    if (c.includes(q)) score += 5;                  // 整体包含加分
    return score;
}

// 方法一：BG型号 + 颜色名 → BL-parts(ITEMID+COLOR) → CODENAME → elements(element_id) → RB型号 + 颜色ID
// 严格遵循需求方流程：
//   1) 在 BL-parts 表中按 (ITEMID, COLOR) 匹配 BG 返回的 (型号, 颜色名)，得到 CODENAME
//   2) 用 CODENAME 匹配 rb_elements 表的 element_id，得到 RB 型号(part_num) 与 颜色ID(color_id)
// 任一步匹配不到则返回 null（交给方法二）。
async function matchRBByColorFallback(bgPartNum, bgColorName) {
    if (!bgPartNum) return null;
    const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '');
    const normItem = norm(bgPartNum);
    if (!normItem) return null;
    const normColor = bgColorName ? norm(bgColorName) : null;

    // —— 第 1 步：BL-parts：(ITEMID + COLOR) → CODENAME ——
    let blParts;
    try {
        blParts = await getAll(RB_STORES.BL_PARTS);
    } catch (e) {
        blParts = []; // 旧库未升级或未导入该表
    }
    if (!blParts.length) return null; // 无 BL-parts 数据 → 方法二

    // 先按 ITEMID 收窄，再在颜色维度上精确匹配
    const itemRows = blParts.filter(r => norm(r.ITEMID) === normItem);
    if (!itemRows.length) return null;

    let hit = normColor
        ? (itemRows.find(r => norm(r.COLOR) === normColor) || null)
        : itemRows[0]; // BG 未提供颜色名时，取该型号唯一/首条映射
    if (!hit || hit.CODENAME == null || hit.CODENAME === '') return null;

    // —— 第 2 步：elements：element_id == CODENAME → RB 型号 + 颜色ID ——
    // CODENAME 在数据源中为数字字符串（对应 element_id 数字主键），导入时会转 numeric；
    // 这里再做一次安全转换，兼容号码边界/前导零等 edge case
    const rawCode = String(hit.CODENAME).trim();
    const numCode = Number(rawCode);
    const elKey = (!isNaN(numCode) && rawCode !== '') ? numCode : rawCode;

    let el;
    try {
        el = await getByKey(RB_STORES.ELEMENTS, elKey);
    } catch (e) {
        el = null;
    }
    if (!el) return null;

    return { rbPartNum: el.part_num, colorId: el.color_id };
}

// 方法二：按 BG 名称模糊搜索候选（精确→模糊排序，至多 10 个，并为每个候选绑定颜色）
async function buildFallbackCandidates(bgName, bgColorName) {
    const allParts = await getAll(RB_STORES.PARTS);
    if (!allParts || !allParts.length) return [];

    // 优先确定 BG 颜色对应的 RB color_id（用于候选优选及兜底展示）
    let bgColorId = null;
    if (bgColorName) {
        const c = await matchColorNameToId(bgColorName);
        if (c) bgColorId = c.id;
    }

    const scored = allParts
        .filter(p => p.name && p.name.trim())
        .map(p => ({ p, score: _nameSimilarityScore(bgName, p.name) }))
        .filter(x => x.score > 0)
        .sort((a, b) => (b.score - a.score) || (a.p.name.length - b.p.name.length))
        .slice(0, 10);

    const out = [];
    for (const { p } of scored) {
        let colorId = null;
        let colorName = '';
        const colors = await getPartColors(p.part_num); // [{ color_id }]
        if (bgColorId !== null && colors.some(c => String(c.color_id) === String(bgColorId))) {
            colorId = bgColorId;                        // 优先使用 BG 颜色
        } else if (colors.length) {
            colorId = colors[0].color_id;               // 否则取该零件第一个颜色
        }
        if (colorId !== null) {
            const cl = await getColorById(colorId);
            if (cl) colorName = cl.name;
        }
        out.push({ part_num: p.part_num, name: p.name, score: Math.round(p.score), colorId, colorName });
    }
    return out;
}

// 保存别名映射（写 RB 离线数据库 + Gitee part_aliases.csv + localStorage）
async function savePartAlias(aliasPartNum, rbPartNum) {
    if (!aliasPartNum || !rbPartNum || aliasPartNum === rbPartNum) return;
    try {
        const result = await persistPartAlias(aliasPartNum, rbPartNum);
        console.log(`[别名]已保存: ${aliasPartNum} → ${rbPartNum}`, result);
    } catch (e) {
        console.warn('[别名]保存失败:', e.message);
    }
}

// 确保别名映射已持久化到线上（Gitee CSV + RB离线库）
// persistPartAlias 内部做合并写回，同一映射再次保存直接覆盖，幂等无需去重判断
async function ensureAliasPersisted(aliasPartNum, rbPartNum) {
    if (!aliasPartNum || !rbPartNum || aliasPartNum === rbPartNum) return;
    await savePartAlias(aliasPartNum, rbPartNum);
}

// 展示成功兑底提示（复用 alias-hint 样式）
function showFallbackSuccessHint(partNum, rbPartNum, methodLabel) {
    const box = document.getElementById('recognize-preview-section');
    if (!box) return;
    const hint = document.createElement('div');
    hint.className = 'alias-hint';
    hint.innerHTML = `ℹ️ 该零件（<b>${partNum}</b>）未直接匹配RB型号，已通过 <b>${methodLabel}</b> 匹配到 <b>${rbPartNum}</b>。保存时将建立别名 ${partNum} → ${rbPartNum}。`;
    box.insertBefore(hint, box.firstChild);
}

// ==================== 手动添加零件时的 BL 匹配（添加零件表单）====================
// 当直接匹配和别名都失败时，用户点击"BL"按钮触发此函数
// 复用兑底匹配的方法一（自动）和方法二（人工选择）

// 刷新添加零件表单的预览（名称、颜色提示、图片、数据来源）
async function _refreshAddPartPreview(originalPartNum, effectivePartNum, forceName = false) {
    const partNameInput = document.getElementById('new-part-name');
    const hintEl = document.getElementById('color-count-hint');
    const dsHint = document.getElementById('data-source-hint');
    const imagePreview = document.getElementById('add-part-image-preview');
    const colorId = document.getElementById('new-part-color')?.value.trim() || '';

    if (dsHint && originalPartNum !== effectivePartNum) {
        dsHint.innerHTML = `数据来源：${effectivePartNum}`;
    }

    // 查找 RB 名称（forceName=true 时始终覆盖为匹配到的 RB 名称）
    if (partNameInput && (forceName || !partNameInput.value)) {
        try {
            const rbPart = await getPartByNum(effectivePartNum);
            if (rbPart && rbPart.name) partNameInput.value = rbPart.name;
        } catch (e) { /* 忽略 */ }
    }

    // 颜色数量提示
    if (hintEl) {
        try {
            const colorCount = await getPartColorCount(effectivePartNum);
            hintEl.textContent = colorCount > 0 ? `可能有${colorCount}种颜色` : '';
        } catch (e) {
            hintEl.textContent = '';
        }
    }

    // 更新图片
    if (imagePreview && effectivePartNum && colorId) {
        try {
            const imgUrl = await getPartImageUrl(effectivePartNum, colorId);
            if (imgUrl) {
                imagePreview.innerHTML = `<img src="${imgUrl}" alt="${effectivePartNum}" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=no-image>暂无图片</div>'">`;
                return;
            }
        } catch (e) { /* 忽略 */ }
    }
    if (imagePreview) {
        imagePreview.innerHTML = '<div class="no-image">暂无图片</div>';
    }
}

async function triggerBLMatchForManual() {
    const partNumInput = document.getElementById('new-part-num');
    const partNameInput = document.getElementById('new-part-name');
    const colorInput = document.getElementById('new-part-color');
    const dsHint = document.getElementById('data-source-hint');

    const partNum = partNumInput.value.trim();
    const colorId = colorInput.value.trim();
    const partName = partNameInput.value.trim();

    if (!partNum) return;

    // 禁用按钮，防止重复点击
    if (dsHint) {
        dsHint.innerHTML = 'RB未匹配 <button class="btn-bl-match" disabled style="opacity:0.5">匹配中...</button>';
    }

    // 如果有颜色ID，获取颜色名称（方法一需要颜色名）
    let colorName = '';
    if (colorId) {
        try {
            const color = await getColorById(parseInt(colorId));
            if (color) colorName = color.name;
        } catch (e) { /* 忽略 */ }
    }

    // 方法一：BL-parts 自动匹配（型号 + 颜色名 → RB 型号）
    const m1 = await matchRBByColorFallback(partNum, colorName);
    if (m1 && m1.rbPartNum) {
        // 匹配成功：不改变型号输入框（保持用户输入），只更新颜色/名称/提示/图片
        if (m1.colorId !== null) {
            colorInput.value = String(m1.colorId);
        }
        // 刷新名称（强制填入RB名称）/颜色提示/图片
        await _refreshAddPartPreview(partNum, m1.rbPartNum, true);
        // 保存别名（下次直接匹配）
        await savePartAlias(partNum, m1.rbPartNum);
        showToast(`BL匹配成功: ${partNum} → ${m1.rbPartNum}`, 2000);
        return;
    }

    // 方法二：按名称模糊搜索候选，由用户人工选择
    const candidates = await buildFallbackCandidates(partName || partNum, colorName);
    if (candidates.length > 0) {
        const picked = await showFallbackCandidatePicker(candidates, {
            partNum: partNum,
            name: partName,
            colorName: colorName
        });
        if (picked && picked.part_num) {
            // 匹配成功：不改变型号输入框（保持用户输入），只更新颜色/名称/提示/图片
            if (picked.colorId != null) {
                colorInput.value = String(picked.colorId);
            }
            await _refreshAddPartPreview(partNum, picked.part_num, true);
            await savePartAlias(partNum, picked.part_num);
            showToast(`BL匹配成功: ${partNum} → ${picked.part_num}`, 2000);
            return;
        }
    } else {
        showToast('BL匹配失败：未找到候选零件', 2000);
    }

    // 匹配失败，恢复 BL 按钮
    if (dsHint) {
        dsHint.innerHTML = 'RB未匹配 <button class="btn-bl-match" onclick="triggerBLMatchForManual()">BL</button>';
    }
}

// 方法二：候选选择面板（左图 + 右文；每行一个卡片；列表与名称垂直滚动）
function showFallbackCandidatePicker(candidates, bgInfo) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'fallback-picker-overlay';

        const sheet = document.createElement('div');
        sheet.className = 'modal-content add-part-modal fallback-picker-modal';

        const cardsHtml = candidates.map(c =>
            `<div class="fallback-part-card" data-part-num="${c.part_num}" data-color-id="${c.colorId != null ? c.colorId : ''}">
                <div class="fallback-card-left">
                    <div class="fallback-card-img" data-img-for="${c.part_num}-${c.colorId}"><div class="no-image">无图</div></div>
                </div>
                <div class="fallback-card-right">
                    <div class="fallback-card-num">${c.part_num}</div>
                    <div class="fallback-card-name">${c.name || '-'}</div>
                    <div class="fallback-card-color">${c.colorId != null ? `颜色：${c.colorName || c.colorId}` : ''}</div>
                </div>
            </div>`
        ).join('');

        sheet.innerHTML = `
            <div class="modal-header">
                <span class="modal-title">未匹配到RB零件，请选择</span>
                <button class="btn-cancel" id="fallback-cancel-btn">取消</button>
            </div>
            <div class="modal-body">
                <div class="fallback-query-info">BG识别：<b>${bgInfo.partNum || ''}</b>${bgInfo.name ? ' · ' + bgInfo.name : ''}${bgInfo.colorName ? ' · ' + bgInfo.colorName : ''}</div>
                <div class="fallback-part-list">
                    ${cardsHtml || '<div class="fallback-empty">无候选零件</div>'}
                </div>
                <div class="fallback-tip">点击匹配的零件完成选择；如无匹配请点「取消」</div>
            </div>
        `;

        // 异步加载每个候选的图片
        candidates.forEach(c => {
            getPartImageUrl(c.part_num, c.colorId).then(url => {
                const el = sheet.querySelector(`[data-img-for="${c.part_num}-${c.colorId}"]`);
                if (el && url) el.innerHTML = `<img src="${url}" alt="${c.part_num}" loading="lazy" />`;
            }).catch(() => {});
        });

        sheet.querySelectorAll('.fallback-part-card').forEach(card => {
            card.addEventListener('click', () => {
                const sel = {
                    part_num: card.dataset.partNum,
                    colorId: card.dataset.colorId !== '' ? Number(card.dataset.colorId) : null
                };
                overlay.remove();
                resolve(sel);
            });
        });

        const cancelBtn = sheet.querySelector('#fallback-cancel-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(null);
        });

        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
    });
}

// ==================== 模型匹配主函数（含兑底逻辑）====================
// 将识别到的型号/名称填入表单，支持别名解析与兑底匹配
// 优先级：场景A 直接匹配 → 场景B 别名解析 → 方法一 自动匹配 → 方法二 人工选择
// 输入框始终显示原始 BG 识别型号（如 4073），别名仅用于内部查询 RB 数据
// 返回解析后的有效 RB 零件型号（可能和输入不同）
async function fillRecognizedPart(partNum, fallbackName, bgColorName) {
    // 0. 重置兑底颜色标志
    recognizeFallbackSetColor = false;

    // 1. 存储识别型号到暂存数据
    recognizeResultData.partNum = partNum;

    // 2. 尝试直接查询 RB 数据库（场景 A）
    let rbPart = null;
    let effectivePartNum = partNum;
    let usedAlias = false;
    let fallbackMethod = null; // 'm1' 自动 | 'm2' 人工

    try {
        rbPart = await getPartByNum(partNum);
    } catch (e) { /* 忽略 */ }

    // 3. 如果在 RB 中找不到，尝试通过别名表解析（场景 B）
    if (!rbPart) {
        const resolvedNum = await resolvePartAlias(partNum);
        if (resolvedNum && resolvedNum !== partNum) {
            effectivePartNum = resolvedNum;
            usedAlias = true;
            try {
                rbPart = await getPartByNum(resolvedNum);
            } catch (e) { /* 忽略 */ }
            console.log(`零件别名解析: ${partNum} → ${resolvedNum}`);
        }
    }

    // 3.5 兑底匹配：场景 A/B 均失败
    if (!rbPart) {
        // —— 方法一：BG型号 + 颜色名 自动匹配 RB ——
        const m1 = await matchRBByColorFallback(partNum, bgColorName);
        if (m1 && m1.rbPartNum) {
            effectivePartNum = m1.rbPartNum;
            usedAlias = true;
            fallbackMethod = 'm1';
            try { rbPart = await getPartByNum(effectivePartNum); } catch (e) { /* 忽略 */ }
            await savePartAlias(partNum, effectivePartNum); // 建立并保存别名
            if (m1.colorId !== null) {
                recognizeResultData.colorId = String(m1.colorId);
                const cl = await getColorById(m1.colorId);
                if (cl) recognizeResultData.colorName = cl.name;
                recognizeFallbackSetColor = true;
            }
            showFallbackSuccessHint(partNum, effectivePartNum, '自动匹配（方法一）');
            console.log(`[兑底]方法一自动匹配: ${partNum} → ${effectivePartNum}`);
        } else {
            // —— 方法二：人工选择候选 ——
            const bgInfoName = recognizeResultData.partName || fallbackName;
            const candidates = await buildFallbackCandidates(bgInfoName, bgColorName);
            const picked = candidates.length
                ? await showFallbackCandidatePicker(candidates, {
                      partNum: partNum,
                      name: bgInfoName,
                      colorName: (recognizeResultData.colorName || bgColorName || '')
                  })
                : null;

            if (picked && picked.part_num) {
                effectivePartNum = picked.part_num;
                usedAlias = true;
                fallbackMethod = 'm2';
                try { rbPart = await getPartByNum(effectivePartNum); } catch (e) { /* 忽略 */ }
                await savePartAlias(partNum, effectivePartNum); // 建立并保存别名
                if (picked.colorId != null) {
                    recognizeResultData.colorId = String(picked.colorId);
                    const cl = await getColorById(picked.colorId);
                    if (cl) recognizeResultData.colorName = cl.name;
                    recognizeFallbackSetColor = true;
                }
                showFallbackSuccessHint(partNum, effectivePartNum, '人工选择（方法二）');
                console.log(`[兑底]方法二人工选择: ${partNum} → ${effectivePartNum}`);
            } else {
                // 人工选择取消 / 无候选 → 提示失败信息
                setRecognizeStatus(`⚠️ 未匹配到该零件的RB型号（BG型号 ${partNum}）。请重新拍摄识别或手动输入`);
                console.warn(`[兑底]方法二取消或失败: ${partNum}`);
            }
        }
    }

    // 4. 名称优先取 RB 数据库，其次用识别结果返回的名称
    let name = fallbackName || '';
    if (rbPart && rbPart.name) {
        name = rbPart.name;
    } else {
        try {
            const p = await getPartByNum(partNum);
            if (p && p.name) name = p.name;
        } catch (e) { /* 忽略 */ }
    }
    recognizeResultData.partName = name;

    // 5. 如果使用了别名（场景 B 或兑底方法一/二），在识别结果区域显示提示
    if (usedAlias && !fallbackMethod) {
        const box = document.getElementById('recognize-preview-section');
        if (box) {
            const hint = document.createElement('div');
            hint.className = 'alias-hint';
            hint.innerHTML = `ℹ️ 该零件（<b>${partNum}</b>）的RB数据（图片/名称/颜色）来源于 <b>${effectivePartNum}</b>，保存时型号保持为 ${partNum}`;
            box.insertBefore(hint, box.firstChild);
        }
    }

    // 6. 更新识别弹窗预览区域
    updateRecognizePreview();

    return effectivePartNum;
}

// 设置识别结果区域的临时状态文本
function setRecognizeStatus(msg) {
    const box = document.getElementById('recognize-result');
    if (!box) return;
    const partNum = recognizeResultData.partNum;
    box.innerHTML = `<div class="recognize-status">${msg}${partNum ? '<br/>已识别型号：<b>' + partNum + '</b>' : ''}</div>`;
    // 显示状态区域（加载中状态可见，完成时会被预览区替代）
    box.style.display = 'block';
}

// 计算图片中零件最接近的5种颜色，按亮度等级匹配（深/较深/正常/较浅/浅）
// 若已知零件型号，只匹配该零件可能有的颜色，大幅提升准确度
// 图片已裁剪到零件包围框，背景已大幅去除，颜色分析更准确
async function computeClosestRBColors(file, partNum) {
    try {
        const img = await fileToImage(file);
        const nw = img.naturalWidth, nh = img.naturalHeight;
        // 判断是否为裁剪后的图片（任一边小于 200px，说明经过裁剪，背景很少）
        const isCropped = nw < 200 || nh < 200;

        // 白平衡校正：优先使用灰卡校准，其次自动估计背景白平衡
        // 裁剪后的图片边缘可能已是零件，不适合用边缘估计背景白平衡，直接使用灰卡校准或跳过
        let wbInfo;
        if (isGrayCardCalibrationActive() && isGrayCardCalibrated()) {
            const gains = getGrayCardGains();
            if (gains) {
                wbInfo = { factors: [gains.r, gains.g, gains.b], bgColor: null };
            } else {
                wbInfo = isCropped ? null : estimateIlluminant(img);
            }
        } else {
            wbInfo = isCropped ? null : estimateIlluminant(img);
        }
        const dominant = getDominantColor(img, wbInfo);
        if (!dominant) return { colors: [], dominantHex: '' };
        const dominantHex = rgbToHex(dominant);

        // 若已知零件型号，只取该零件可能有的颜色，否则取全部颜色
        let rbColors = [];
        if (partNum) {
            let partElements = await getPartColors(partNum);
            // 如果直接查询无结果，尝试通过别名解析
            if (!partElements || partElements.length === 0) {
                const resolvedNum = await resolvePartAlias(partNum);
                if (resolvedNum && resolvedNum !== partNum) {
                    partElements = await getPartColors(resolvedNum);
                }
            }
            const colorIds = new Set(partElements.map(e => String(e.color_id)));
            if (colorIds.size > 0) {
                const allColors = await getAllColors();
                rbColors = allColors.filter(c => colorIds.has(String(c.id)));
            }
        }
        if (rbColors.length === 0) {
            rbColors = await getAllColors();
        }
        const entries = rbColors.map(c => {
            const rgb = parseHexColor(c.rgb);
            return rgb ? { id: c.id, name: c.name || ('颜色' + c.id), rgb, lab: rgbToLab(rgb) } : null;
        }).filter(Boolean);

        // 计算主色 Lab
        const dominantLab = rgbToLab(dominant);

        // 5 个曝光等级：-0.7EV, -0.3EV, 0EV, +0.3EV, +0.7EV
        // EV → 亮度乘数：2^(EV)
        const evLevels = [-0.7, -0.3, 0, 0.3, 0.7];
        const levels = evLevels.map(ev => ({
            fn: c => c.map(v => Math.round(Math.max(0, Math.min(255, v * Math.pow(2, ev)))))
        }));

        const usedIds = new Set();
        const results = [];
        for (const { fn } of levels) {
            const adjusted = fn(dominant);
            const adjustedLab = rgbToLab(adjusted);
            // 找当前亮度下最接近且尚未推荐的 RB 颜色
            const sorted = entries
                .filter(e => !usedIds.has(e.id))
                .sort((a, b) => deltaE76(adjustedLab, a.lab) - deltaE76(adjustedLab, b.lab));
            if (sorted.length) {
                const match = sorted[0];
                usedIds.add(match.id);
                results.push({ id: match.id, name: match.name, hex: rgbToHex(match.rgb) });
            }
        }
        // 若不足 6 个，补足（用 dominantLab 匹配剩余，确保有足够推荐颜色）
        if (results.length < 6) {
            entries.filter(e => !usedIds.has(e.id))
                .sort((a, b) => deltaE76(dominantLab, a.lab) - deltaE76(dominantLab, b.lab))
                .slice(0, 6 - results.length)
                .forEach(r => { usedIds.add(r.id); results.push({ id: r.id, name: r.name, hex: rgbToHex(r.rgb) }); });
        }
        return { colors: results, dominantHex };
    } catch (e) {
        console.error('计算最接近颜色失败:', e);
        return { colors: [], dominantHex: '' };
    }
}

// 渲染颜色预选区（7行格式）
// 第1行：标题"颜色预选"
// 第2行：BG 返回的颜色（色块 + 颜色ID + BG颜色名称），默认选中
// 第3-7行：5个计算的推荐颜色（色块 + 颜色ID + 颜色名称）
// 第2-7行共6行是待选颜色，默认第2行
function renderRecognizeColors(colors, dominantHex, bgColorId, bgColorName) {
    const listEl = document.getElementById('color-preselect-list');
    const preselectSection = document.getElementById('color-preselection');
    if (!listEl || !preselectSection) return;

    // 确定默认选中索引：优先 BG 颜色（第1行，index=0），其次第一个
    let defaultSelectedIdx = 0;
    let bgColorIndex = -1;
    if (bgColorId !== null && bgColorId !== undefined) {
        bgColorIndex = colors.findIndex(c => c.id === Number(bgColorId));
        if (bgColorIndex >= 0) defaultSelectedIdx = 0;
    }

    // 分离 BG 颜色（第1行）和推荐颜色（第2-6行）
    let bgColor = null;
    const recommended = [];
    colors.forEach((c, idx) => {
        const isBg = bgColorId !== null && bgColorId !== undefined && c.id === Number(bgColorId);
        if (isBg) {
            bgColor = c;
        } else {
            recommended.push(c);
        }
    });

    // 如果 BG 颜色不在 colors 中但 bgColorName 存在，用 note 提示
    let bgColorNoteHtml = '';
    if (bgColorName && bgColorId === null) {
        bgColorNoteHtml = `<div class="recognize-color-note">BG识别颜色：${bgColorName}（未匹配到RB颜色ID）</div>`;
    }
    // 如果 BG 颜色不在列表中但有 bgColorId，尝试显示
    if (!bgColor && bgColorId !== null && bgColorId !== undefined && bgColorName) {
        bgColor = { id: Number(bgColorId), name: bgColorName, hex: dominantHex || '#ccc' };
    }

    // 构建行列表
    let rowsHtml = '';

    // 第1行：BG 颜色
    if (bgColor) {
        rowsHtml += `
            <div class="color-row selected" data-color-id="${bgColor.id}" data-color-name="${bgColor.name}">
                <span class="color-row-swatch" style="background:${bgColor.hex}"></span>
                <span class="color-row-id">ID: ${bgColor.id}</span>
                <span class="color-row-name">${bgColor.name}</span>
            </div>`;
    }

    // 第2-6行：推荐颜色（最多5个）
    recommended.slice(0, 5).forEach((c) => {
        rowsHtml += `
            <div class="color-row" data-color-id="${c.id}" data-color-name="${c.name}">
                <span class="color-row-swatch" style="background:${c.hex}"></span>
                <span class="color-row-id">ID: ${c.id}</span>
                <span class="color-row-name">${c.name}</span>
            </div>`;
    });

    // 如果没有任何颜色数据，保持占位文字
    if (!rowsHtml) {
        listEl.innerHTML = '<div style="padding:12px;text-align:center;color:#999;font-size:13px;">拍照识别后将显示推荐颜色</div>';
        return;
    }

    // 写入颜色行
    listEl.innerHTML = bgColorNoteHtml + rowsHtml;

    // 绑定点击事件
    const rows = listEl.querySelectorAll('.color-row');
    rows.forEach((row) => {
        row.addEventListener('click', () => {
            recognizeResultData.colorId = row.dataset.colorId;
            recognizeResultData.colorName = row.dataset.colorName;
            updateRecognizePreview();
            rows.forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
        });
    });

    // 默认选中 BG 颜色行（第1行）
    const firstRow = listEl.querySelector('.color-row');
    if (firstRow) {
        firstRow.classList.add('selected');
        recognizeResultData.colorId = firstRow.dataset.colorId;
        recognizeResultData.colorName = firstRow.dataset.colorName;
        updateRecognizePreview();
    }
}

// ==================== 同名零件消歧 ====================
// 某些零件虽然型号不同（如 3063b 和 85080），但外表相同或相似，名称也一样。
// 拍照识别时，两个型号都有可能被识别到。此功能在 BG 识别后，
// 按名称在 RB 数据库中匹配所有同名零件，展示零件卡片供用户选择确认。

// 显示同名零件选择器
async function showSameNamePartsPicker(partName, currentPartNum) {
    if (!partName || !currentPartNum) return;

    // 从 RB 数据库搜索同名零件
    const sameNameParts = await searchPartsByNameInRB(partName);
    if (!sameNameParts || sameNameParts.length <= 1) return; // 没有同名零件，无需选择

    // 排除当前已选型号
    const otherParts = sameNameParts.filter(p => p.part_num !== currentPartNum);
    if (otherParts.length === 0) return;

    // 检查是否已经显示过同名零件选择器（避免重复）
    const existingPicker = document.getElementById('same-name-parts-picker');
    if (existingPicker) return;

    // 创建选择器UI
    const box = document.getElementById('recognize-preview-section');
    if (!box) return;

    const pickerDiv = document.createElement('div');
    pickerDiv.id = 'same-name-parts-picker';
    pickerDiv.className = 'same-name-parts-picker';

    // 获取所有同名零件的图片
    let cardsHtml = '';
    for (const part of sameNameParts) {
        const imgUrl = await getPartImageUrl(part.part_num, 0); // 用 color_id=0 获取通用图片
        const isCurrent = part.part_num === currentPartNum;
        cardsHtml += `
            <div class="same-name-part-card ${isCurrent ? 'selected' : ''}" data-part-num="${part.part_num}" data-part-name="${part.name}">
                <div class="snp-image">
                    ${imgUrl ? `<img src="${imgUrl}" alt="${part.part_num}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'snp-no-img\\'>无图</div>'">` : '<div class="snp-no-img">无图</div>'}
                </div>
                <div class="snp-info">
                    <div class="snp-part-num">${part.part_num}</div>
                    <div class="snp-part-name">${part.name}</div>
                </div>
                ${isCurrent ? '<div class="snp-badge">当前</div>' : ''}
            </div>`;
    }

    // 如果所有卡片都一样（只有当前型号过滤了），就不显示选择器
    if (otherParts.length === 0) {
        pickerDiv.innerHTML = `
            <div class="snp-header">
                <span class="snp-title">📋 同名零件</span>
                <span class="snp-hint">${sameNameParts.length} 个零件共享此名称</span>
            </div>
            <div class="snp-cards-row">
                ${cardsHtml}
            </div>
            <div class="snp-footer">
                <span class="snp-current-tip">已选择: <b>${currentPartNum}</b></span>
            </div>
        `;
    } else {
        pickerDiv.innerHTML = `
            <div class="snp-header">
                <span class="snp-title">📋 同名零件确认</span>
                <span class="snp-hint">检测到 ${sameNameParts.length} 个零件共享此名称，请确认型号</span>
            </div>
            <div class="snp-cards-row">
                ${cardsHtml}
            </div>
        `;
    }

    // 绑定点击事件
    setTimeout(() => {
        pickerDiv.querySelectorAll('.same-name-part-card').forEach(card => {
            card.addEventListener('click', () => {
                // 取消其他选中
                pickerDiv.querySelectorAll('.same-name-part-card').forEach(c => {
                    c.classList.remove('selected');
                    const badge = c.querySelector('.snp-badge');
                    if (badge) badge.remove();
                });
                card.classList.add('selected');

                const partNum = card.dataset.partNum;
                const partName = card.dataset.partName;

                // 更新暂存数据
                recognizeResultData.partNum = partNum;
                recognizeResultData.partName = partName;
                updateRecognizePreview();

                // 添加"当前"标记
                const badge = document.createElement('div');
                badge.className = 'snp-badge';
                badge.textContent = '当前';
                card.appendChild(badge);

                console.log(`用户选择同名零件: ${partNum}`);
            });
        });
    }, 0);

    box.appendChild(pickerDiv);
}

// 在 RB 数据库中按名称搜索零件（精确匹配和模糊匹配）
async function searchPartsByNameInRB(partName) {
    if (!partName) return [];
    try {
        const db = await openRBDatabase();
        const allParts = await getAll(RB_STORES.PARTS);
        const cleanName = partName.trim().toLowerCase();

        // 1. 精确匹配（名称完全相同，不区分大小写）
        let results = allParts.filter(p =>
            p.name && p.name.toLowerCase().trim() === cleanName
        );

        // 2. 如果精确匹配结果太少，尝试包含匹配（名称中包含关键词）
        if (results.length <= 1) {
            const broader = allParts.filter(p => {
                if (!p.name) return false;
                const pn = p.name.toLowerCase().trim();
                return pn.includes(cleanName) || cleanName.includes(pn);
            });
            if (broader.length > results.length) {
                results = broader;
            }
        }

        return results;
    } catch (error) {
        console.error('搜索同名零件失败:', error);
        return [];
    }
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

// 从图片边缘区域估计白平衡校正因子和背景色
function estimateIlluminant(img) {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (w < 100 || h < 100) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    let data;
    try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return null; }

    // 采样外 15% 边框区域的像素（背景）
    // 放宽范围到 150~252，以适应非纯白背景
    const border = 0.15;
    const samples = [];
    let fallbackSamples = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const inBorder = x < w * border || x > w * (1 - border) ||
                            y < h * border || y > h * (1 - border);
            if (!inBorder) continue;
            const i = (y * w + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const bright = r + g + b;
            // 取接近白色但未过曝的像素（各通道 150~252）
            if (r > 150 && g > 150 && b > 150 && r < 252 && g < 252 && b < 252) {
                samples.push([r, g, b]);
            }
            // 降级采样：所有较亮的边缘像素（用于深色背景场景）
            if (bright > 400) {
                fallbackSamples.push([r, g, b]);
            }
        }
    }
    // 如果纯白像素不足，使用降级采样
    const useSamples = samples.length >= 50 ? samples : (fallbackSamples.length >= 50 ? fallbackSamples : samples);
    if (useSamples.length < 50) return null;

    let avgR = 0, avgG = 0, avgB = 0;
    for (const p of useSamples) { avgR += p[0]; avgG += p[1]; avgB += p[2]; }
    avgR /= useSamples.length; avgG /= useSamples.length; avgB /= useSamples.length;

    // 计算校正因子：使平均色变为中性灰，限制在 0.7~1.3
    const gray = (avgR + avgG + avgB) / 3;
    const factors = [
        Math.max(0.7, Math.min(1.3, gray / avgR)),
        Math.max(0.7, Math.min(1.3, gray / avgG)),
        Math.max(0.7, Math.min(1.3, gray / avgB))
    ];
    // 校正后的背景色（用于后续排除背景像素）
    const bgCorrected = [
        Math.round(Math.max(0, Math.min(255, avgR * factors[0]))),
        Math.round(Math.max(0, Math.min(255, avgG * factors[1]))),
        Math.round(Math.max(0, Math.min(255, avgB * factors[2])))
    ];
    return { factors, bgColor: bgCorrected };
}

function applyWB(pixel, factors) {
    return [
        Math.round(Math.max(0, Math.min(255, pixel[0] * factors[0]))),
        Math.round(Math.max(0, Math.min(255, pixel[1] * factors[1]))),
        Math.round(Math.max(0, Math.min(255, pixel[2] * factors[2])))
    ];
}

// 提取图片主色：先去除背景，再对零件区域做颜色分桶
// 采用"抠图"思路：从边缘采样背景色 → 排除背景像素 → 只保留零件像素
function getDominantColor(img, wbInfo) {
    const wbFactors = wbInfo ? wbInfo.factors : null;
    const bgColor = wbInfo ? wbInfo.bgColor : null;
    // 没有背景色信息时（如裁剪后的图片），直接使用中心区域法，跳过边缘背景采样
    const noBackground = !wbInfo || (!wbInfo.bgColor && !wbInfo.factors);

    // 缩小到 128x128 分析，兼顾性能与精度
    const W = 128, H = 128;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, W, H);
    let data;
    try { data = ctx.getImageData(0, 0, W, H).data; } catch (e) { return null; }

    // 1. 确定背景色
    // 优先使用 estimateIlluminant 提供的背景色，否则从边缘采样
    let bgR, bgG, bgB;
    if (bgColor) {
        bgR = bgColor[0]; bgG = bgColor[1]; bgB = bgColor[2];
    } else if (!noBackground) {
        // 从边缘 15% 区域采样背景色
        const border = 0.15;
        let sumR = 0, sumG = 0, sumB = 0, cnt = 0;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const inBorder = x < W * border || x > W * (1 - border) ||
                                y < H * border || y > H * (1 - border);
                if (!inBorder) continue;
                const i = (y * W + x) * 4;
                sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2];
                cnt++;
            }
        }
        if (cnt === 0) return null;
        bgR = sumR / cnt; bgG = sumG / cnt; bgB = sumB / cnt;
    }

    // 2. 提取前景像素（与背景色差异明显的像素）
    // 动态阈值：根据背景色亮度调整，背景越亮阈值越高
    const partPixels = [];
    let useFallback = noBackground; // 无背景信息时，直接走回退路径

    if (!noBackground) {
        const bgBrightness = (bgR + bgG + bgB) / 3;
        const bgThreshold = Math.max(25, Math.min(50, Math.round(bgBrightness / 10)));
        const bgThreshold2 = bgThreshold * bgThreshold;
        const border = 0.12; // 分析时去掉边缘 12%（避免边缘残留背景）

        for (let y = Math.round(border * H); y < H - Math.round(border * H); y++) {
            for (let x = Math.round(border * W); x < W - Math.round(border * W); x++) {
                const i = (y * W + x) * 4;
                let r = data[i], g = data[i + 1], b = data[i + 2];
                // 应用白平衡校正
                if (wbFactors) {
                    const c = applyWB([r, g, b], wbFactors);
                    r = c[0]; g = c[1]; b = c[2];
                }
                // 计算与背景色的色差平方
                const dr = r - bgR, dg = g - bgG, db = b - bgB;
                if (dr * dr + dg * dg + db * db > bgThreshold2) {
                    partPixels.push([r, g, b]);
                }
            }
        }

        // 如果前景像素太少，降低阈值重试
        if (partPixels.length < 80) {
            const lowerThreshold = Math.max(18, Math.round(bgThreshold * 0.7));
            const lowerThreshold2 = lowerThreshold * lowerThreshold;
            for (let y = Math.round(border * H); y < H - Math.round(border * H); y++) {
                for (let x = Math.round(border * W); x < W - Math.round(border * W); x++) {
                    const i = (y * W + x) * 4;
                    let r = data[i], g = data[i + 1], b = data[i + 2];
                    if (wbFactors) {
                        const c = applyWB([r, g, b], wbFactors);
                        r = c[0]; g = c[1]; b = c[2];
                    }
                    const dr = r - bgR, dg = g - bgG, db = b - bgB;
                    if (dr * dr + dg * dg + db * db > lowerThreshold2) {
                        partPixels.push([r, g, b]);
                    }
                }
            }
        }

        // 如果还是太少，回退到中心区域法
        if (partPixels.length < 50) {
            useFallback = true;
        }
    }

    // 3. 颜色分桶，找最大桶
    const buckets = new Map();

    if (!useFallback) {
        for (const [r, g, b] of partPixels) {
            // 只跳过极暗的孤立噪点（亮度 < 24，即 8+8+8）
            if (r + g + b < 24) continue;
            const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
            let bk = buckets.get(key);
            if (!bk) { bk = { cnt: 0, rs: 0, gs: 0, bs: 0 }; buckets.set(key, bk); }
            bk.cnt++; bk.rs += r; bk.gs += g; bk.bs += b;
        }
    }

    // 回退路径：中心区域（扩大至 50%）+ 自动排除边缘残留背景
    if (useFallback || buckets.size === 0) {
        const cropRatio = 0.50; // 从 35% 扩大到 50%，保证包含更多零件像素
        const cw = Math.round(img.naturalWidth * cropRatio);
        const ch = Math.round(img.naturalHeight * cropRatio);
        const ox = Math.round((img.naturalWidth - cw) / 2);
        const oy = Math.round((img.naturalHeight - ch) / 2);
        const canvas2 = document.createElement('canvas');
        canvas2.width = 64;
        canvas2.height = 64;
        const ctx2 = canvas2.getContext('2d');
        if (!ctx2) return null;
        ctx2.drawImage(img, ox, oy, cw, ch, 0, 0, 64, 64);
        let data2;
        try { data2 = ctx2.getImageData(0, 0, 64, 64).data; } catch (e) { return null; }

        // 如果无背景色信息（如裁剪后的图片），从中心区域边缘采样残留背景色
        let edgeBgR = null, edgeBgG = null, edgeBgB = null;
        if (!bgColor) {
            let eSumR = 0, eSumG = 0, eSumB = 0, eCnt = 0;
            const edge = 8; // 边缘 8px（64px 的 12.5%）
            for (let y = 0; y < 64; y++) {
                for (let x = 0; x < 64; x++) {
                    if (x >= edge && x < 64 - edge && y >= edge && y < 64 - edge) continue;
                    const i = (y * 64 + x) * 4;
                    eSumR += data2[i]; eSumG += data2[i+1]; eSumB += data2[i+2];
                    eCnt++;
                }
            }
            if (eCnt > 0) {
                edgeBgR = eSumR / eCnt;
                edgeBgG = eSumG / eCnt;
                edgeBgB = eSumB / eCnt;
            }
        }

        for (let i = 0; i < data2.length; i += 4) {
            let r = data2[i], g = data2[i + 1], b = data2[i + 2];
            if (wbFactors) {
                const c = applyWB([r, g, b], wbFactors);
                r = c[0]; g = c[1]; b = c[2];
            }
            // 只跳过极暗的孤立噪点
            if (r + g + b < 24) continue;
            // 如果已知背景色，排除与背景接近的像素
            if (bgColor) {
                const dr = r - bgColor[0], dg = g - bgColor[1], db = b - bgColor[2];
                if (dr * dr + dg * dg + db * db < bgThreshold2) continue;
            }
            // 如果从边缘采样了残留背景色，排除接近的像素（针对裁剪后仍残留背景的情况）
            if (edgeBgR !== null) {
                const dr = r - edgeBgR, dg = g - edgeBgG, db = b - edgeBgB;
                if (dr * dr + dg * dg + db * db < 400) continue; // 阈值 20^2
            }
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
// 共享的拍照识别核心：压缩图片 → Brickognize 识别 → 别名解析，结果通过回调返回
let recognizePhotoInput = null;

// 通用拍照识别入口（供搜索页“识别”与清单弹窗“识别”复用）
function recognizePartPhoto(callback) {
    // 确保隐藏文件输入存在
    if (!recognizePhotoInput) {
        recognizePhotoInput = document.createElement('input');
        recognizePhotoInput.type = 'file';
        recognizePhotoInput.accept = 'image/*';
        recognizePhotoInput.style.display = 'none';
        recognizePhotoInput.addEventListener('change', async () => {
            const file = recognizePhotoInput.files && recognizePhotoInput.files[0];
            if (!file) return;
            recognizePhotoInput.value = '';

            try {
                const compressed = await compressImage(file, 1024);
                if (!compressed) { alert('图片处理失败'); return; }
                const candidate = await uploadToBrickognize(compressed);
                if (!candidate) { alert('未识别到零件，请重试'); return; }

                // 别名解析：如果型号在 RB 中找不到，尝试通过别名映射查找
                const resolvedNum = await resolvePartAlias(candidate.id);

                // 名称：优先从 RB 数据库获取，别名解析后使用别名对应的 RB 数据
                let name = candidate.name || '';
                if (resolvedNum !== candidate.id) {
                    try {
                        const rbPart = await getPartByNum(resolvedNum);
                        if (rbPart && rbPart.name) {
                            name = rbPart.name;
                        }
                    } catch(e) {}
                }

                if (callback) callback({ id: candidate.id, resolvedNum, name, colorId: candidate.colorId });
            } catch (err) {
                console.error('拍照识别失败:', err);
                alert('识别失败：' + (err && err.message ? err.message : '网络错误'));
            }
        });
        document.body.appendChild(recognizePhotoInput);
    }
    recognizePhotoInput.click();
}

function recognizePartFromSearch() {
    recognizePartPhoto((result) => {
        // 始终显示原始 BG 识别型号（如 4073）
        document.getElementById('search-part-num').value = result.id;

        document.getElementById('search-part-name').value = result.name;

        // 如果 BG 返回了颜色，自动填入颜色ID
        if (result.colorId !== null && result.colorId !== undefined) {
            document.getElementById('search-color-id').value = result.colorId;
            updateColorPickButton(result.colorId);
        }

        // 在型号输入框下方显示数据来源提示（始终显示）
        const dsHint = document.getElementById('search-data-source-hint');
        if (dsHint) {
            dsHint.textContent = `数据来源：${result.resolvedNum}`;
        }

        // 执行搜索
        handleAdvancedSearch();
    });
}

function togglePartNewStatus(isNew) {
    window.newPartIsNew = isNew;
    document.getElementById('status-new').classList.toggle('active', isNew);
    document.getElementById('status-used').classList.toggle('active', !isNew);
}

// ==================== 灰卡白平衡校准 ====================

// 打开相机拍照进行灰卡校准
function calibrateGrayCard() {
    const input = document.getElementById('gray-card-camera-input');
    if (!input) return;
    input.value = ''; // 允许重复选择
    input.click();
}

// 处理灰卡校准照片
async function processGrayCardFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type || file.type.indexOf('image/') !== 0) {
        alert('请选择图片文件');
        return;
    }

    const statusTextEl = document.getElementById('gray-card-status-text');
    const instructionEl = document.getElementById('gray-card-instruction');
    if (statusTextEl) {
        statusTextEl.textContent = '正在分析灰卡...';
        statusTextEl.className = 'gray-card-status-text calibrating';
    }

    try {
        // 压缩图片
        const compressed = await compressImage(file, 1024);
        if (!compressed) { alert('图片处理失败'); return; }

        // 加载图片到 Canvas 进行分析
        const img = await fileToImage(compressed);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { alert('无法处理图片'); return; }
        ctx.drawImage(img, 0, 0);

        // 取画面中央 40% 区域作为灰卡分析区域（假设用户将灰卡放在画面中央）
        const cropRatio = 0.40;
        const cw = Math.round(img.naturalWidth * cropRatio);
        const ch = Math.round(img.naturalHeight * cropRatio);
        const ox = Math.round((img.naturalWidth - cw) / 2);
        const oy = Math.round((img.naturalHeight - ch) / 2);
        const pixels = ctx.getImageData(ox, oy, cw, ch);

        // 计算灰卡区域的平均 R/G/B
        // 排除过暗（<30）和过曝（>245）的像素，以及接近纯色的像素（饱和度太高）
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        for (let i = 0; i < pixels.data.length; i += 4) {
            const r = pixels.data[i];
            const g = pixels.data[i + 1];
            const b = pixels.data[i + 2];
            const brightness = r + g + b;
            // 排除过暗/过曝像素
            if (brightness < 90 || brightness > 735) continue;
            // 排除高饱和度像素（防止灰卡区域有反光点或杂物）
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            if (max - min > 40) continue;
            rSum += r; gSum += g; bSum += b;
            count++;
        }

        if (count < 100) {
            if (statusTextEl) {
                statusTextEl.textContent = '❌ 未检测到灰卡区域，请确保灰卡在画面中央';
                statusTextEl.className = 'gray-card-status-text error';
            }
            if (instructionEl) instructionEl.style.display = 'block';
            return;
        }

        const avgR = rSum / count;
        const avgG = gSum / count;
        const avgB = bSum / count;

        // 18% 灰卡在 sRGB 中的理论值 ≈ 128（中性灰）
        // 以 G 通道为基准，使 G 增益 = 1.0，归一化 R 和 B
        const target = 128;
        const gainR = target / avgR;
        const gainG = target / avgG;
        const gainB = target / avgB;

        // 归一化，保持整体亮度不变
        const meanGain = (gainR + gainG + gainB) / 3;
        const gains = {
            r: gainR / meanGain,
            g: gainG / meanGain,
            b: gainB / meanGain
        };

        // 保存校准结果
        setGrayCardGains(gains);
        setGrayCardCalibrationActive(true);

        // 更新 UI
        if (statusTextEl) {
            statusTextEl.textContent = `✓ 已校准`;
            statusTextEl.className = 'gray-card-status-text calibrated';
        }
        if (instructionEl) {
            instructionEl.style.display = 'block';
            const scrollText = instructionEl.querySelector('.area2-scroll-text');
            if (scrollText) scrollText.textContent = '灰卡白平衡已校准，点击"校准"可重新校准';
        }
        const clearBtn = document.getElementById('gray-card-clear-btn');
        if (clearBtn) clearBtn.style.display = 'inline-block';

        alert('灰卡白平衡校准完成！后续拍照将自动应用校正。');
    } catch (err) {
        console.error('灰卡校准失败:', err);
        if (statusTextEl) {
            statusTextEl.textContent = '❌ 校准失败：' + (err.message || '未知错误');
            statusTextEl.className = 'gray-card-status-text error';
        }
    }
}

// 切换灰卡校准模式开关
function toggleGrayCardMode(active) {
    setGrayCardCalibrationActive(active);
    const statusTextEl = document.getElementById('gray-card-status-text');
    if (statusTextEl) {
        statusTextEl.textContent = active ? '✓ 已校准（已启用）' : '✓ 已校准（已禁用）';
        statusTextEl.className = 'gray-card-status-text ' + (active ? 'calibrated' : 'disabled');
    }
}

// 清除灰卡校准（UI 操作）
function resetGrayCardCalibrationUI() {
    if (!confirm('确定清除灰卡白平衡校准数据？')) return;
    resetGrayCardCalibration();
    const statusTextEl = document.getElementById('gray-card-status-text');
    const instructionEl = document.getElementById('gray-card-instruction');
    if (statusTextEl) {
        statusTextEl.textContent = '未校准';
        statusTextEl.className = 'gray-card-status-text uncalibrated';
    }
    if (instructionEl) {
        instructionEl.style.display = 'block';
        const scrollText = instructionEl.querySelector('.area2-scroll-text');
        if (scrollText) scrollText.textContent = '将 18% 灰卡放在零件拍摄位置，点击"校准"拍照';
    }
    const clearBtn = document.getElementById('gray-card-clear-btn');
    if (clearBtn) clearBtn.style.display = 'none';
}

// 应用灰卡白平衡增益到像素数据
function applyGrayCardWB(imageData, gains) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        data[i]     = Math.min(255, Math.max(0, Math.round(data[i] * gains.r)));
        data[i + 1] = Math.min(255, Math.max(0, Math.round(data[i + 1] * gains.g)));
        data[i + 2] = Math.min(255, Math.max(0, Math.round(data[i + 2] * gains.b)));
    }
    return imageData;
}

// 从图片文件应用灰卡白平衡校正（返回校正后的 JPEG Blob）
async function applyGrayCardToImage(file) {
    const img = await fileToImage(file);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gains = getGrayCardGains();
    if (gains) {
        imageData = applyGrayCardWB(imageData, gains);
        ctx.putImageData(imageData, 0, 0);
    }
    return new Promise(resolve => {
        canvas.toBlob(blob => {
            if (!blob) { resolve(null); return; }
            resolve(new File([blob], 'graycard_corrected.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.92);
    });
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
    
    if (isNaN(quantity)) {
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
                // 确保别名映射已持久化到线上
                const originalPartNum = recognizeResultData.partNum;
                if (originalPartNum && originalPartNum !== partNum) {
                    await ensureAliasPersisted(originalPartNum, partNum);
                }
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
                // 确保别名映射已持久化到线上
                const originalPartNum = recognizeResultData.partNum;
                if (originalPartNum && originalPartNum !== partNum) {
                    await ensureAliasPersisted(originalPartNum, partNum);
                }
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
        // 确保别名映射已持久化到线上
        const originalPartNum = recognizeResultData.partNum;
        if (originalPartNum && originalPartNum !== partNum) {
            await ensureAliasPersisted(originalPartNum, partNum);
        }
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

            // 来源标签
            let sourceLabel = '';
            if (data.source === 'offline') sourceLabel = '离线';
            else if (data.source === 'supabase') sourceLabel = '缓存';
            else if (data.source === 'browser') sourceLabel = 'BL在线';
            else sourceLabel = '在线';

            // 在线抓取成功（FastAPI 或 CORS 代理），尝试写入 Gitee weights.json 以支持后续离线使用
            if (data.source === undefined || data.source === 'browser') {
                try {
                    const giteeResult = await addWeightToGiteeJSON(cleanPartNum, data.weight);
                    if (giteeResult.success) {
                        if (messageEl) {
                            messageEl.style.color = '#27ae60';
                            messageEl.textContent = `获取成功（${sourceLabel}）：${cleanPartNum} = ${data.weight}g（已保存至 Gitee weights.json，建议更新 RB 数据库以离线使用）`;
                        }
                    } else {
                        if (messageEl) {
                            messageEl.style.color = '#27ae60';
                            messageEl.textContent = `获取成功（${sourceLabel}）：${cleanPartNum} = ${data.weight}g（保存至 Gitee 失败：${giteeResult.error}）`;
                        }
                    }
                } catch (e) {
                    if (messageEl) {
                        messageEl.style.color = '#27ae60';
                        messageEl.textContent = `获取成功（${sourceLabel}）：${cleanPartNum} = ${data.weight}g（保存至 Gitee 异常：${e.message}）`;
                    }
                }
            } else {
                if (messageEl) {
                    messageEl.style.color = '#27ae60';
                    messageEl.textContent = `获取成功（${sourceLabel}）：${cleanPartNum} = ${data.weight}g`;
                }
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

    // 尝试解析别名：如果 partNum 在 RB 中找不到颜色，尝试用别名查询
    let effectivePartNum = partNum;
    let partColors = await getPartColors(partNum);
    if ((!partColors || partColors.length === 0) && partNum) {
        const resolvedNum = await resolvePartAlias(partNum);
        if (resolvedNum && resolvedNum !== partNum) {
            partColors = await getPartColors(resolvedNum);
            if (partColors && partColors.length > 0) {
                effectivePartNum = resolvedNum;
            }
        }
    }

    if (!partColors || partColors.length === 0) {
        grid.innerHTML = '<div style="text-align: center; padding: 20px; color: #999; grid-column: 1 / -1;">该零件在RB数据库中未找到颜色记录<br>请直接输入颜色ID</div>';
        return;
    }

    // 如果使用了别名，更新模态框标题显示
    if (effectivePartNum !== partNum) {
        // 别名解析后，颜色数据使用有效型号
        // 标题保持原样："选择颜色 (partNum)"
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
                // 手动触发 input 事件，让预览相关监听器得以执行
                colorInput.dispatchEvent(new Event('input', { bubbles: true }));
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
    const idStr = String(colorId ?? '').trim();
    
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



// 名称搜索精度选项：6级（0-5），从精准100%到模糊50%
const NAME_PRECISION_OPTIONS = [
    { level: 0, pct: 100, label: '精准'   },
    { level: 1, pct: 90,  label: '较准'   },
    { level: 2, pct: 80,  label: '标准'   },
    { level: 3, pct: 70,  label: '较模糊' },
    { level: 4, pct: 60,  label: '模糊'   },
    { level: 5, pct: 50,  label: '最模糊' }
];

// 更新名称精度按钮文字，显示当前等级
function updateNamePrecisionBtn() {
    const btn = document.getElementById('search-name-precision-btn');
    if (!btn) return;
    const level = getSearchNamePrecisionLevel();
    btn.textContent = '精度 ' + level;
}

// 名称搜索精度提示文案
function precisionHintText(level) {
    const opt = NAME_PRECISION_OPTIONS[level];
    if (!opt) return '';
    return `精度 ${-level}（${opt.label} ${opt.pct}%）`;
}

// 打开名称搜索精度设置弹窗：六格橙色色块横条，透明度从左到右 100%→50%，
// 依次对应提示 0、-1、-2、-3、-4、-5
function showNamePrecisionPicker() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content name-precision-modal';

    const current = getSearchNamePrecisionLevel();

    const barHtml = NAME_PRECISION_OPTIONS.map(opt => {
        const opacity = 1 - opt.level * 0.1;
        return `
            <div class="np-block-wrap" onclick="setNamePrecision(${opt.level})">
                <div class="np-block ${opt.level === current ? 'selected' : ''}"
                     style="opacity:${opacity}"></div>
                <span class="np-block-label">${-opt.level}</span>
            </div>
        `;
    }).join('');

    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">名称搜索精度</span>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="np-bar">${barHtml}</div>
            <div class="np-hint" id="np-hint">${precisionHintText(current)}</div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
}

// 设置名称搜索精度等级并关闭弹窗
function setNamePrecision(level) {
    localStorage.setItem('searchNamePrecision', String(level));
    updateNamePrecisionBtn();
    const picker = document.querySelector('.name-precision-modal');
    if (picker) picker.closest('.modal-overlay').remove();
}

// 通用颜色选择弹窗（供搜索页“选色”与清单弹窗“选色”复用）
function showColorPickerModal(partNum, onSelect) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content color-picker-modal';

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

    loadColorPickerGrid(partNum, onSelect);

    document.getElementById('color-search-input').addEventListener('input', function(e) {
        filterColors(e.target.value);
    });
}

function showSearchColorPicker() {
    const partNum = document.getElementById('search-part-num').value.trim();
    showColorPickerModal(partNum, (colorId) => {
        document.getElementById('search-color-id').value = colorId;
        updateColorPickButton(colorId);
    });
}

async function loadColorPickerGrid(partNum, onSelect) {
    const grid = document.getElementById('color-grid');
    let colors = [];

    // 若有型号，先按零件可用颜色加载
    if (partNum) {
        let partColors = await getPartColors(partNum);
        // 如果直接查询无结果，尝试通过别名解析
        if (!partColors || partColors.length === 0) {
            const resolvedNum = await resolvePartAlias(partNum);
            if (resolvedNum && resolvedNum !== partNum) {
                partColors = await getPartColors(resolvedNum);
            }
        }
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
            if (onSelect) onSelect(color.id);
            e.target.closest('.modal-overlay').remove();
        });

        grid.appendChild(colorCard);
    });
}

async function handleAdvancedSearch() {
    const partNumInput = document.getElementById('search-part-num');
    const nameInput = document.getElementById('search-part-name');
    const originalPartNum = partNumInput.value;
    const params = {
        part_num: originalPartNum,
        name: nameInput.value,
        color_id: document.getElementById('search-color-id').value,
        is_new: document.getElementById('search-status').value === '' ? undefined : 
               document.getElementById('search-status').value === 'true',
        repo_ids: searchSelectedRepos && searchSelectedRepos.size > 0 ? Array.from(searchSelectedRepos) : undefined
    };
    
    let parts = await advancedSearchParts(params);
    let aliasUsed = false;
    let resolvedNum = null;

    // 如果按型号搜索没有结果，尝试通过别名解析查找
    if (params.part_num && parts.length === 0) {
        resolvedNum = await resolvePartAlias(params.part_num);
        if (resolvedNum && resolvedNum !== params.part_num) {
            console.log(`搜索别名解析: ${params.part_num} → ${resolvedNum}`);
            // 不改变输入框，仅用别名搜索库存
            const aliasParams = { ...params, part_num: resolvedNum };
            parts = await advancedSearchParts(aliasParams);
            aliasUsed = true;
        }
    }

    // 渲染搜索结果
    renderSearchResults(parts);

    // 更新数据来源提示
    const dsHint = document.getElementById('search-data-source-hint');
    if (dsHint) {
        dsHint.textContent = aliasUsed && resolvedNum ? `数据来源：${resolvedNum}` : '';
    }

    // 清除旧提示
    const oldHint = document.querySelector('.search-alias-hint');
    if (oldHint) oldHint.remove();
    const results = document.getElementById('search-results');

    // 如果使用了别名，在搜索结果显示提示
    if (aliasUsed && results) {
        const hint = document.createElement('div');
        hint.className = 'alias-hint search-alias-hint';
        hint.style.marginBottom = '8px';
        let msg = `ℹ️ 型号 <b>${originalPartNum}</b> 在RB数据库中对应为 <b>${resolvedNum}</b>，已使用该型号查询库存`;
        if (parts.length > 0) {
            msg += `，找到 ${parts.length} 个结果`;
        }
        hint.innerHTML = msg;
        results.prepend(hint);
    }

    // 如果搜索无结果但使用了别名，显示RB零件信息卡片供参考
    if (parts.length === 0 && aliasUsed && results && resolvedNum) {
        try {
            const rbPart = await getPartByNum(resolvedNum);
            if (rbPart) {
                const imgUrl = await getPartImageUrl(rbPart.part_num, 0);
                const infoCard = document.createElement('div');
                infoCard.className = 'rb-part-info-card';
                infoCard.innerHTML = `
                    <div class="rb-part-info-header">RB数据库零件信息</div>
                    <div class="rb-part-info-body">
                        ${imgUrl ? `<div class="rb-part-info-img"><img src="${imgUrl}" alt="${rbPart.part_num}" onerror="this.parentElement.style.display='none'"></div>` : ''}
                        <div class="rb-part-info-details">
                            <div class="rb-part-info-num">型号: <b>${rbPart.part_num}</b></div>
                            <div class="rb-part-info-name">名称: ${rbPart.name || '-'}</div>
                        </div>
                    </div>
                    <div class="rb-part-info-footer">提示: 输入型号 ${originalPartNum} 已通过别名映射到 ${resolvedNum}，但库存中暂无此零件</div>
                `;
                results.appendChild(infoCard);
            }
        } catch(e) {}
    }
}

// 更新选色按钮样式：根据颜色ID设置底色和文字颜色
async function updateColorPickButton(colorId) {
    const btn = document.querySelector('.btn-color-pick');
    if (!btn) return;

    if (colorId === null || colorId === undefined || colorId === '') {
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

// 搜索时已选中的仓库（repository）ID 集合（多选）及其名称缓存
let searchSelectedRepos = new Set();
let searchRepoNames = {};

function resetSearchFilters() {
    document.getElementById('search-part-num').value = '';
    document.getElementById('search-part-name').value = '';
    document.getElementById('search-color-id').value = '';
    document.getElementById('search-status').value = '';
    searchSelectedRepos = new Set();
    renderSearchSelectedRepos();
    document.getElementById('search-results').innerHTML = '';
    updateColorPickButton('');
    const dsHint = document.getElementById('search-data-source-hint');
    if (dsHint) dsHint.textContent = '';
}

// 在"仓库"下方区域 A 渲染所有仓库的缩小卡片（未选白底黑字 / 已选绿底白字），点击 A 打开弹窗
async function renderSearchSelectedRepos() {
    const container = document.getElementById('search-repo-selected');
    if (!container) return;
    if (Object.keys(searchRepoNames).length === 0) {
        const repos = await getRepositories();
        (repos || []).forEach(r => { searchRepoNames[r.id] = r.name; });
    }
    const entries = Object.entries(searchRepoNames);
    container.innerHTML = '';
    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'search-repo-mini-empty';
        empty.textContent = '暂无仓库';
        container.appendChild(empty);
        return;
    }
    entries.forEach(([id, name]) => {
        const card = document.createElement('div');
        card.className = 'search-repo-mini' + (searchSelectedRepos.has(Number(id)) ? ' selected' : '');
        card.textContent = name;
        card.title = name;
        container.appendChild(card);
    });
}

// 打开仓库选择弹窗（多选，仓库以卡片形式展示）
async function openSearchWarehouseSelect() {
    const repos = await getRepositories();
    (repos || []).forEach(r => { searchRepoNames[r.id] = r.name; });
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'search-repo-overlay';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeSearchWarehouseSelect();
    });

    const sheet = document.createElement('div');
    sheet.className = 'modal-content search-repo-modal';
    sheet.innerHTML = `
        <div class="search-repo-header">
            <span class="search-repo-title">待选仓库</span>
            <span class="search-repo-count" id="search-repo-selected-count"></span>
            <span class="search-repo-actions">
                <button class="btn-secondary" onclick="closeSearchWarehouseSelect()">取消</button>
                <button class="btn-primary" onclick="closeSearchWarehouseSelect()">确定</button>
            </span>
        </div>
        <div class="search-repo-grid" id="search-repo-grid"></div>
    `;
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const grid = document.getElementById('search-repo-grid');
    if (!repos || repos.length === 0) {
        grid.innerHTML = '<div class="search-repo-empty">暂无仓库</div>';
    } else {
        repos.forEach(repo => {
            const card = document.createElement('div');
            card.className = 'search-repo-card' + (searchSelectedRepos.has(repo.id) ? ' selected' : '');
            card.dataset.id = repo.id;
            card.textContent = repo.name;
            card.title = repo.name;
            card.addEventListener('click', () => toggleSearchWarehouse(repo.id, card));
            grid.appendChild(card);
        });
    }
    updateSearchRepoCount();
}

// 切换某个仓库的选中状态
function toggleSearchWarehouse(repoId, card) {
    if (searchSelectedRepos.has(repoId)) {
        searchSelectedRepos.delete(repoId);
        card.classList.remove('selected');
    } else {
        searchSelectedRepos.add(repoId);
        card.classList.add('selected');
    }
    updateSearchRepoCount();
}

// 更新弹窗内已选仓库数量
function updateSearchRepoCount() {
    const countEl = document.getElementById('search-repo-selected-count');
    if (countEl) countEl.textContent = searchSelectedRepos.size > 0 ? `已选 ${searchSelectedRepos.size} 个` : '';
}

// 关闭仓库选择弹窗并刷新"仓库"下方已选卡片
function closeSearchWarehouseSelect() {
    const overlay = document.getElementById('search-repo-overlay');
    if (overlay) overlay.remove();
    renderSearchSelectedRepos();
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
    updateNamePrecisionBtn();
}

// 抓取并渲染 BL 价格（右滑打开价格面板时调用）。
// 依据 part 的 RB 型号 + RB 颜色ID，解析为 BL 目标并发起价格指南抓取。
// 优先走后端无头浏览器（绕过 WAF 返回两组价格），失败回退到 CORS 代理单块抓取。
async function fetchAndRenderBLPrice(priceEl, part) {
    if (!priceEl) return;
    priceEl.innerHTML = '<div class="pd-price-head">BL价格</div><div class="pd-price-loading">加载中...</div>';
    const failMsg = (msg) => { priceEl.innerHTML = `<div class="pd-price-head">BL价格</div><div class="pd-price-error">${msg}</div>`; };
    // 渲染单条价格记录（两组：Last 6 Months / Current for Sale）
    const renderPriceData = (rec, sourceLabel) => {
        const c = rec && rec.currency ? rec.currency + ' ' : '';
        const block = (title, p) => {
            if (!p) return `<div class="pd-price-block"><div class="pd-price-sub">${title} · New</div><div class="pd-price-error">无数据</div></div>`;
            const rows = [];
            if (p.min != null) rows.push(`<div class="pd-price-item"><span class="pd-price-label">Min</span><span class="pd-price-val">${c}${p.min}</span></div>`);
            if (p.avg != null) rows.push(`<div class="pd-price-item"><span class="pd-price-label">Avg</span><span class="pd-price-val">${c}${p.avg}</span></div>`);
            if (p.qty_avg != null) rows.push(`<div class="pd-price-item"><span class="pd-price-label">Qty Avg</span><span class="pd-price-val">${c}${p.qty_avg}</span></div>`);
            if (p.max != null) rows.push(`<div class="pd-price-item"><span class="pd-price-label">Max</span><span class="pd-price-val">${c}${p.max}</span></div>`);
            return `<div class="pd-price-block"><div class="pd-price-sub">${title} · New</div>${rows.join('') || '<div class="pd-price-error">无数据</div>'}</div>`;
        };
        const day = rec && rec.saved_at ? rec.saved_at.slice(0, 10) : '';
        const srcTag = sourceLabel ? `<div class="pd-price-src">${sourceLabel}</div>` : '';
        priceEl.innerHTML =
            '<div class="pd-price-head">BL价格</div>' +
            (day ? `<div class="pd-price-day">${day}</div>` : '') +
            srcTag +
            block('6个月销量', rec && rec.last_6_months)
            + block('当前在售', rec && rec.current_for_sale) +
            '<div class="pd-price-refresh" id="pd-price-refresh">↻ 重新获取</div>';
        const btn = priceEl.querySelector('#pd-price-refresh');
        if (btn) btn.addEventListener('click', (e) => {
            e.stopPropagation();
            renderAndFetchFresh(priceEl, part);
        });
    };

    // 重新获取 / 首次拉取：读缓存→自动→手动
    const renderAndFetchFresh = async (el, p) => {
        el.innerHTML = '<div class="pd-price-head">BL价格</div><div class="pd-price-loading">加载中...</div>';
        try {
            const target = await resolveBLTargetSafe(p);
            // 服务端未配置时明确提示（便于排查：价格为何不能现抓）
            if (typeof BL_PRICE_SERVER === 'undefined' || !BL_PRICE_SERVER) {
                console.warn('[BL价格] 服务端未配置 BL_PRICE_SERVER，按需抓取未启用，将走离线缓存/手动回填');
            }
            let auto = null;
            // 优先服务端按需抓取（server_bricklink_price.py，每次独立冷启动浏览器）
            if (typeof fetchBLPriceFromServer === 'function') {
                auto = await fetchBLPriceFromServer(target.blPartNum, target.blColorId);
            }
            if (auto && (auto.last_6_months || auto.current_for_sale)) {
                const rec = normalizePriceRecord(target, auto, 'bl-server');
                if (typeof saveCachedBLPrice === 'function') await saveCachedBLPrice(rec);
                renderPriceData(rec, '已从服务端抓取');
                return;
            }
            // 服务端未配置或失败：回退浏览器直抓/CORS 代理
            if (typeof tryAutoFetchBLPrice === 'function') {
                auto = await tryAutoFetchBLPrice(target.blPartNum, target.blColorId);
            }
            if (auto && (auto.last_6_months || auto.current_for_sale)) {
                const rec = normalizePriceRecord(target, auto, 'auto');
                if (typeof saveCachedBLPrice === 'function') await saveCachedBLPrice(rec);
                renderPriceData(rec, '已从Bricklink自动抓取');
                return;
            }
            // 自动未成：新标签打官方页 + 手动回填
            openManualPriceDialog(target, p)
                .then((rec) => {
                    if (rec) {
                        if (typeof saveCachedBLPrice === 'function') saveCachedBLPrice(rec);
                        renderPriceData(rec, '手动回填');
                        return;
                    }
                    renderCachedOrFail(el, p);
                })
                .catch((err) => {
                    console.error('手动填价失败:', err);
                    renderCachedOrFail(el, p);
                });
        } catch (e) {
            console.error('BL价格拉取失败:', e);
            renderCachedOrFail(el, p);
        }
    };

    // 全部失败时：若有缓存读缓存，否则提示
    const renderCachedOrFail = async (el, p) => {
        try {
            const target = await resolveBLTargetSafe(p);
            const cached = (typeof getCachedBLPrice === 'function') ? await getCachedBLPrice(target.blPartNum, target.blColorId) : null;
            if (cached && (cached.last_6_months || cached.current_for_sale)) {
                renderPriceData(cached, '本地缓存');
                return;
            }
        } catch (e) { /* 忽略 */ }
        failMsg('价格获取失败或暂无数据');
    };

    // 组装 target（解析型号/颜色）
    const resolveBLTargetSafe = async (p) => {
        if (typeof resolveBLTarget !== 'function') throw new Error('离线库未就绪');
        const target = await resolveBLTarget(p.part_num, p.color_id);
        if (!target) throw new Error('无法解析BL型号/颜色');
        return target;
    };

    // 将抓取结果规整为本地缓存记录
    const normalizePriceRecord = (target, data, source) => ({
        key: `${target.blPartNum}:${target.blColorId}`,
        part_num: target.blPartNum,
        color_id: target.blColorId,
        currency: (data && data.currency) || '',
        last_6_months: (data && data.last_6_months) || null,
        current_for_sale: (data && data.current_for_sale) || null,
        source: source || 'manual',
        saved_at: new Date().toISOString()
    });

    // 主流程：缓存优先
    try {
        if (typeof resolveBLTarget !== 'function') { failMsg('离线库未就绪'); return; }
        const target = await resolveBLTarget(part.part_num, part.color_id);
        if (!target) { failMsg('无法解析BL型号/颜色'); return; }
        const cached = (typeof getCachedBLPrice === 'function') ? await getCachedBLPrice(target.blPartNum, target.blColorId) : null;
        if (cached && (cached.last_6_months || cached.current_for_sale)) {
            renderPriceData(cached, '本地缓存');
            return;
        }
        // 无缓存：进入 自动→手动 流程
        renderAndFetchFresh(priceEl, part);
    } catch (e) {
        failMsg(`错误: ${(e && e.message) || e}`);
    }
}

// 在 Bricklink 官方价格页运行的"取价脚本"（收藏夹脚本）。
// 用法：官方页把地址栏改为粘贴这段脚本并回车，它会把两组价格以 JSON 复制到剪贴板，
// 回到本弹窗点"从剪贴板导入"，无需手打。
const BL_PRICE_BOOKMARKLET =
    "javascript:(()=>{" +
    "var h=document.body.innerHTML;" +
    "var re=/<td>(Min Price|Qty Avg Price|Avg Price|Max Price):<\\/td>\\s*<td><b>([A-Z]{2,3})?(?:\\s|&nbsp;|\\u00a0)*([\\d,]+\\.\\d+)<\\/b><\\/td>/gi;" +
    "var out={min:[],avg:[],qty_avg:[],max:[]},map={'Min Price':'min','Avg Price':'avg','Qty Avg Price':'qty_avg','Max Price':'max'},m;" +
    "while((m=re.exec(h))!==null){var k=map[m[1]];if(k&&out[k])out[k].push([(m[2]||'').toUpperCase(),parseFloat(m[3].replace(/,/g,''))]);}" +
    "var blk=function(col){function g(k){return out[k][col]?out[k][col][1]:null;}return {min:g('min'),avg:g('avg'),qty_avg:g('qty_avg'),max:g('max')};};" +
    "var cur=(h.indexOf('CNY')>=0?'CNY':(h.indexOf('USD')>=0?'USD':''));" +
    "var json=JSON.stringify({cur:cur,l6:blk(0),cs:blk(2)});" +
    "navigator.clipboard.writeText(json).then(function(){window.alert('已复制价格，回到Rebrickable点「从剪贴板导入」');})" +
    ".catch(function(){window.prompt('复制下面内容到app导入框：',json);});" +
    "})();";

// 手动回填价格弹窗：先新标签打开 Bricklink 官方价格页（设备真实浏览器可过 WAF 看到价），
// 用户对照页面把 New 的 Min/Avg/Qty Avg/Max 填入，保存后 Promise resolve 一条本地价格记录。
// resolve(rec) 成功 / resolve(null) 取消或关闭。
function openManualPriceDialog(target, part) {
    return new Promise((resolve) => {
        // 打开官方价格页（同型号+颜色，方便对照填价），不阻塞本弹窗
        const blPage = `https://www.bricklink.com/catalogPG.asp?P=${encodeURIComponent(target.blPartNum)}&colorID=${encodeURIComponent(target.blColorId)}`;
        window.open(blPage, '_blank');
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        const sheet = document.createElement('div');
        sheet.className = 'modal-content pd-mprice';
        sheet.innerHTML = `
            <div class="pd-mprice-title">手动填写 BL 价格</div>
            <div class="pd-mprice-tip">已为你打开 <b>${target.blPartNum}</b> 官方价格页（新标签）。<b>推荐</b>：<b>①</b>先在官方页把地址改为粘贴"取价脚本"并回车（价格会自动复制）；<b>②</b>回到这里点<b>从剪贴板导入</b>自动填好，再点保存。也可直接对照页面手填。</div>
            <div class="pd-mprice-toolbar">
                <button type="button" class="pd-mprice-import" id="pd-mp-import">↑ 从剪贴板导入</button>
                <button type="button" class="pd-mprice-copy" id="pd-mp-copy">📋 复制取价脚本</button>
                <div class="pd-mprice-hint" id="pd-mp-hint"></div>
            </div>
            <div class="pd-mprice-currency"><label>币种</label><input id="pd-mp-cur" type="text" value="CNY" maxlength="3" placeholder="CNY"></div>
            <div class="pd-mprice-group">
                <div class="pd-mprice-gtitle">Last 6 Months Sales</div>
                <div class="pd-mprice-row"><label>Min</label><input id="pd-mp-l6-min" type="number" step="0.01" min="0"></div>
                <div class="pd-mprice-row"><label>Avg</label><input id="pd-mp-l6-avg" type="number" step="0.01" min="0"></div>
                <div class="pd-mprice-row"><label>Qty Avg</label><input id="pd-mp-l6-qavg" type="number" step="0.01" min="0"></div>
                <div class="pd-mprice-row"><label>Max</label><input id="pd-mp-l6-max" type="number" step="0.01" min="0"></div>
            </div>
            <div class="pd-mprice-group">
                <div class="pd-mprice-gtitle">Current Items for Sale</div>
                <div class="pd-mprice-row"><label>Min</label><input id="pd-mp-cs-min" type="number" step="0.01" min="0"></div>
                <div class="pd-mprice-row"><label>Avg</label><input id="pd-mp-cs-avg" type="number" step="0.01" min="0"></div>
                <div class="pd-mprice-row"><label>Qty Avg</label><input id="pd-mp-cs-qavg" type="number" step="0.01" min="0"></div>
                <div class="pd-mprice-row"><label>Max</label><input id="pd-mp-cs-max" type="number" step="0.01" min="0"></div>
            </div>
            <div class="pd-mprice-actions">
                <button type="button" class="pd-mprice-cancel" id="pd-mp-cancel">取消</button>
                <button type="button" class="pd-mprice-save" id="pd-mp-save">保存</button>
            </div>`;

        const close = () => {
            overlay.remove();
            document.body.classList.remove('modal-open');
        };
        const parseNum = (id) => {
            const raw = overlay.querySelector(id).value.trim();
            if (raw === '') return null;
            const v = parseFloat(raw);
            return isNaN(v) ? null : v;
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); resolve(null); } });
        sheet.querySelector('#pd-mp-cancel').addEventListener('click', () => { close(); resolve(null); });
        sheet.querySelector('#pd-mp-save').addEventListener('click', () => {
            const cur = (overlay.querySelector('#pd-mp-cur').value.trim() || 'CNY').toUpperCase();
            const rec = {
                key: `${target.blPartNum}:${target.blColorId}`,
                part_num: target.blPartNum,
                color_id: target.blColorId,
                currency: cur,
                last_6_months: {
                    currency: cur,
                    min: parseNum('#pd-mp-l6-min'),
                    avg: parseNum('#pd-mp-l6-avg'),
                    qty_avg: parseNum('#pd-mp-l6-qavg'),
                    max: parseNum('#pd-mp-l6-max')
                },
                current_for_sale: {
                    currency: cur,
                    min: parseNum('#pd-mp-cs-min'),
                    avg: parseNum('#pd-mp-cs-avg'),
                    qty_avg: parseNum('#pd-mp-cs-qavg'),
                    max: parseNum('#pd-mp-cs-max')
                },
                source: 'manual',
                saved_at: new Date().toISOString()
            };
            close();
            resolve(rec);
        });
        const hintEl = () => overlay.querySelector('#pd-mp-hint');
        const setHint = (text, color) => {
            const el = hintEl();
            if (el) {
                el.textContent = text || '';
                el.style.color = color || '#888';
            }
        };
        overlay.querySelector('#pd-mp-import').addEventListener('click', async () => {
            let text = '';
            try { text = await navigator.clipboard.readText(); } catch (e) { text = ''; }
            let obj = null;
            if (text) { try { obj = JSON.parse(text); } catch (e) { obj = null; } }
            if (!obj || typeof obj !== 'object' || (!obj.l6 && !obj.cs)) {
                setHint('剪贴板未找到取价数据。请先在官方页粘贴运行"取价脚本"，再回来导入。', '#e53935');
                return;
            }
            if (obj.cur) overlay.querySelector('#pd-mp-cur').value = String(obj.cur).toUpperCase();
            const fill = (prefix, p) => {
                if (!p) return;
                [['min', 'min'], ['avg', 'avg'], ['qty_avg', 'qavg'], ['max', 'max']].forEach(([k, id]) => {
                    const v = p[k];
                    if (v != null) { const inp = overlay.querySelector(`#pd-mp-${prefix}-${id}`); if (inp) inp.value = v; }
                });
            };
            fill('l6', obj.l6);
            fill('cs', obj.cs);
            setHint('已从剪贴板导入，核对后点保存', '#2e7d32');
        });
        overlay.querySelector('#pd-mp-copy').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(BL_PRICE_BOOKMARKLET);
                setHint('取价脚本已复制！请到已打开的官方页，把地址栏整段替换成这段脚本并回车。', '#1565c0');
            } catch (e) {
                setHint('复制失败，请在官方页手动粘贴脚本', '#e53935');
            }
        });

        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
        document.body.classList.add('modal-open');
    });
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

    // 检测零件型号是否为别名映射（如 BG 识别型号 4073 → RB 6141）
    // 若是，在型号后以绿色括号显示映射到的 RB 标准型号
    let aliasRbNum = '';
    try {
        const resolvedNum = await resolvePartAlias(part.part_num);
        if (resolvedNum && String(resolvedNum).trim() !== String(part.part_num).trim()) {
            aliasRbNum = resolvedNum;
        }
    } catch (e) {
        console.warn('获取别名映射RB型号失败:', e);
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
        // 缓存时机：图片在零件卡片/详情 <img> onload 成功时即写入离线缓存（见 autoCachePartImage）。
        // 这里不再主动预取，避免每次进入详情都重复触发“缓存中”与重复网络请求。
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
        const onloadAttr = `onload="autoCachePartImage('${part.part_num}', ${part.color_id}, this)"`;
        imageHtml = `<img src="${imgUrl}" alt="${rbName}" class="pd-image" ${onloadAttr} onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=pd-no-image>加载失败</div>'">`;
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
            <div class="pd-image-price" id="pd-image-price">
                <div class="pd-price-head">BL价格</div>
                <div class="pd-price-hint">右滑显示</div>
            </div>
            <div class="pd-image-content">
                ${imageHtml}
            </div>
            <div class="pd-image-action">
                <button class="pd-img-change-btn" onclick="changePartImage('${part.part_num}', ${part.color_id})">${imgBtnText}</button>
                <button class="pd-img-url-btn" onclick="showPartImageUrl('${part.part_num}', ${part.color_id})">图片URL</button>
                <button class="pd-img-url-btn pd-bl-match-btn" onclick="blReconfigurePartById(${part.id})">BL重配</button>
            </div>
        </div>
        <div class="pd-row pd-model-row">
            <span class="pd-left">型号：<span class="pd-model">${part.part_num}</span>${aliasRbNum ? `<span class="pd-alias-rb-num">（${aliasRbNum}）</span>` : ''}</span>
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
        currentQty = currentQty - 1;
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

    // 状态栏长按1秒：变更零件新旧状态
    const statusEl = sheet.querySelector('.pd-status');
    let statusTimer = null;
    const startStatusLongPress = (e) => {
        e.preventDefault();
        statusTimer = setTimeout(() => {
            changePartStatus(part);
        }, 1000);
    };
    const cancelStatusLongPress = () => {
        if (statusTimer) {
            clearTimeout(statusTimer);
            statusTimer = null;
        }
    };
    statusEl.addEventListener('mousedown', startStatusLongPress);
    statusEl.addEventListener('mouseup', cancelStatusLongPress);
    statusEl.addEventListener('mouseleave', cancelStatusLongPress);
    statusEl.addEventListener('touchstart', startStatusLongPress, { passive: false });
    statusEl.addEventListener('touchend', cancelStatusLongPress);
    statusEl.addEventListener('touchmove', cancelStatusLongPress);

    // 图片左滑显示变更按钮 + 右滑显示 BL 价格面板（价格#pd-image-price位于图片左侧）
    const imageSwipe = sheet.querySelector('#pd-image-swipe');
    const imageContent = imageSwipe.querySelector('.pd-image-content');
    const imageAction = imageSwipe.querySelector('.pd-image-action');
    const imagePrice = imageSwipe.querySelector('#pd-image-price');
    const actionWidth = 90;
    const priceWidth = 160;
    let startX = 0, currentX = 0, isSwiping = false;
    let isActionOpen = false, isPriceOpen = false, priceFetched = false;

    // 统一渲染三块的位置：内容 / 右侧操作 / 左侧价格
    function renderSwipe() {
        imageContent.style.transform = `translateX(${currentX}px)`;
        imageAction.style.transform = `translateX(${currentX + actionWidth}px)`;
        imagePrice.style.transform = `translateX(${currentX - priceWidth}px)`;
    }

    imageContent.style.transition = 'transform 0.25s ease';
    imageAction.style.transition = 'transform 0.25s ease';
    imagePrice.style.transition = 'transform 0.25s ease';

    imageSwipe.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        isSwiping = true;
        imageContent.style.transition = 'none';
        imageAction.style.transition = 'none';
        imagePrice.style.transition = 'none';
        currentX = isActionOpen ? -actionWidth : (isPriceOpen ? priceWidth : 0);
        renderSwipe();
    }, { passive: true });

    imageSwipe.addEventListener('touchmove', (e) => {
        if (!isSwiping || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - startX;
        const baseX = isActionOpen ? -actionWidth : (isPriceOpen ? priceWidth : 0);
        currentX = Math.max(-actionWidth, Math.min(priceWidth, baseX + dx));
        renderSwipe();
    }, { passive: true });

    imageSwipe.addEventListener('touchend', () => {
        if (!isSwiping) return;
        isSwiping = false;
        imageContent.style.transition = 'transform 0.25s ease';
        imageAction.style.transition = 'transform 0.25s ease';
        imagePrice.style.transition = 'transform 0.25s ease';

        if (currentX > priceWidth / 2) {
            isPriceOpen = true;
            isActionOpen = false;
            currentX = priceWidth;
        } else if (currentX < -actionWidth / 2) {
            isActionOpen = true;
            isPriceOpen = false;
            currentX = -actionWidth;
        } else {
            isActionOpen = false;
            isPriceOpen = false;
            currentX = 0;
        }
        renderSwipe();

        // 右滑打开价格面板时，仅首次触发抓取并渲染
        if (isPriceOpen && !priceFetched) {
            priceFetched = true;
            fetchAndRenderBLPrice(imagePrice, part);
        }
    }, { passive: true });

    // 初始化位置：内容居中，右侧操作移出、左侧价格移出
    renderSwipe();

    // 合并按钮点击事件
    const mergeBtn = sheet.querySelector('#pd-merge-btn');
    mergeBtn.addEventListener('click', () => {
        showMergePartSelector(part);
    });
}

// 长按状态栏弹窗：变更零件新旧状态（纠正添加零件时的失误）
function changePartStatus(part) {
    const isNew = Boolean(part.is_new);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    const box = document.createElement('div');
    box.className = 'modal-content';
    box.style.cssText = 'max-width:320px;padding:20px;text-align:center;';
    box.innerHTML = `
        <div style="margin-bottom:16px;font-size:16px;font-weight:bold;">变更零件状态</div>
        <div style="margin-bottom:20px;font-size:14px;color:#888;">${part.part_num}（当前：${isNew ? '新' : '旧'}）</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
            <button id="status-set-new" style="padding:12px;border:none;border-radius:8px;background:#4CAF50;color:#fff;font-size:14px;cursor:pointer;">设为新品</button>
            <button id="status-set-used" style="padding:12px;border:none;border-radius:8px;background:#ff9800;color:#fff;font-size:14px;cursor:pointer;">设为旧品</button>
            <button id="status-cancel" style="padding:10px;border:none;border-radius:8px;background:#666;color:#fff;font-size:14px;cursor:pointer;">取消</button>
        </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    const doSet = (val) => {
        overlay.remove();
        applyPartStatus(part, val);
    };
    box.querySelector('#status-set-new').onclick = () => doSet(true);
    box.querySelector('#status-set-used').onclick = () => doSet(false);
    box.querySelector('#status-cancel').onclick = () => overlay.remove();
}

// 应用状态变更：更新数据库 + 详情状态栏 + 列表/搜索显示
async function applyPartStatus(part, isNew) {
    if (Boolean(part.is_new) === Boolean(isNew)) return;
    const success = await updatePart(part.id, { is_new: isNew });
    if (!success) {
        alert('保存失败');
        return;
    }
    part.is_new = isNew;
    // 更新详情页状态栏
    const sheet = document.querySelector('.part-detail-modal');
    if (sheet) {
        const statusEl = sheet.querySelector('.pd-status');
        if (statusEl) {
            statusEl.textContent = isNew ? '新' : '旧';
            statusEl.className = 'pd-status ' + (isNew ? 'pd-status-new' : 'pd-status-used');
        }
    }
    // 更新搜索结果卡片
    updateSearchResultStatus(part.id, isNew);
    // 刷新当前盒子零件列表
    if (selectedBox) {
        await loadParts(selectedBox.id);
    }
    showToast(isNew ? '已设为新品' : '已设为旧品');
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

// 显示零件图片三级URL（①离线缓存区 ②Gitee ③RB数据库）
async function showPartImageUrl(partNum, colorId) {
    const giteeUrl = buildPartsImgUrl(partNum, colorId);
    let cached = false, giteeOk = false, rbUrls = [];
    let cacheEntry = null, cacheDiag = '';
    try {
        [cacheEntry, giteeOk, rbUrls] = await Promise.all([
            getPartImageFromOfflineCache(partNum, colorId),
            checkPartsImgOnGitee(partNum, colorId),
            getRBPartImageUrls(partNum, colorId)
        ]);
        cached = !!cacheEntry;
        cacheDiag = cacheEntry
            ? `已命中 · ${cacheEntry.type}/${cacheEntry.status}`
            : `未命中 · 最近写入错误: ${_lastCacheWriteError || '无'}`;
        console.log('【图片URL诊断】', partNum, colorId, 'giteeUrl=', giteeUrl, 'cached=', cached, 'cacheEntry=', cacheEntry, '_lastCacheWriteError=', _lastCacheWriteError);
    } catch (e) {
        console.warn('获取零件图片URL失败:', e);
        cacheDiag = '查询出错已回退 · ' + (e && e.message);
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
            <div style="font-size:11px;color:#999;margin:4px 0 12px;word-break:break-all;">诊断：${cacheDiag}</div>
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

// ==================== BL重配：重新匹配零件型号到RB（直接RB / BL匹配RB）====================
// 零件详情页触发。流程：
//   1) 匹配模型：直接RB匹配 → 别名解析 → BL匹配（matchRBByColorFallback 的 方法一）
//   2) 弹窗展示匹配结果（型号 / 名称 / 颜色 / 图片+URL），用户确认
//   3) 更新零件基本信息（仅名称/颜色；原BL型号保持不变，RB 关系写入别名映射）
//   4) 检查别名映射：无记录则新增保存；有记录则比较，相同返回，不同让用户选择后更新

// 入口：按零件ID查询后执行重配
async function blReconfigurePartById(partId) {
    let part;
    try {
        part = await getPartById(partId);
    } catch (e) {
        part = null;
    }
    if (!part) {
        alert('获取零件信息失败');
        return;
    }
    await reconfigurePartBLMatch(part);
}

// ==================== 批量BL重配：遍历同型号全部记录，不去重列出所有配对供选择 ====================
// 流程：
//   1) 输入原型号（如 32209）
//   2) 遍历系统中该型号全部记录，对每条记录依次用 直接RB / 别名解析 / BL匹配 产出候选配对
//      （同一型号不同颜色可能得到不同结果），不去重、也不合并为单一"胜出"结果
//   3) 展示所有候选配对 + 一个"直接匹配RB（删除别名）"选项，由用户选择
//   4) 按选择更新别名映射文件：删除 / 变更 / 添加
// 入口：设置-数据管理-RB数据管理-批量BL重配
function blBatchReconfigure() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'bl-batch-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'modal-content';
    sheet.style.maxWidth = '440px';
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    sheet.innerHTML = `
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span class="modal-title" style="font-size:16px;font-weight:600;">批量BL重配</span>
            <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()" style="background:#f44336;color:white;padding:6px 14px;font-size:13px;border:none;border-radius:4px;cursor:pointer;">关闭</button>
        </div>
        <div class="modal-body">
            <div style="font-size:13px;color:#666;margin-bottom:8px;">输入原型号（如 32209），将遍历该型号全部记录并列出所有匹配配对：</div>
            <input type="text" id="bl-batch-num" class="form-input" placeholder="请输入零件型号" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:15px;box-sizing:border-box;">
            <div style="display:flex;gap:8px;margin-top:12px;">
                <button id="bl-batch-run" style="flex:1;padding:10px;border:none;border-radius:6px;background:#2196F3;color:#fff;font-size:14px;cursor:pointer;">开始匹配</button>
            </div>
            <div id="bl-batch-result" style="margin-top:14px;"></div>
        </div>
    `;

    const numInput = sheet.querySelector('#bl-batch-num');
    const runBtn = sheet.querySelector('#bl-batch-run');
    const resultEl = sheet.querySelector('#bl-batch-result');

    runBtn.onclick = async () => {
        const num = numInput.value.trim();
        if (!num) return;
        await runBLBatchMatch(num, resultEl);
    };
    numInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runBtn.click();
    });
}

// 执行批量匹配：遍历该型号全部记录，收集候选配对（不去重）
async function runBLBatchMatch(num, resultEl) {
    resultEl.innerHTML = '<div style="color:#888;text-align:center;padding:16px 0;">正在遍历匹配…</div>';

    // 1. 找出系统中所有该型号的记录
    let records = [];
    try {
        const all = await searchParts({ part_num: num });
        records = (all || []).filter(p => String(p.part_num).trim() === num);
    } catch (e) {
        console.warn('[批量BL重配]查询记录失败:', e.message);
    }

    // 2. 对每条记录收集候选配对（不去重：保留各匹配方式产出的不同结果）
    const candMap = new Map(); // key = method|rb
    const addCandidate = (method, methodLabel, rb, colorId) => {
        const alias = num;
        if (!rb) return;
        const key = `${method}|${String(rb).trim()}`;
        if (candMap.has(key)) {
            const c = candMap.get(key);
            c.count++;
            if (colorId != null && c.colorId == null) c.colorId = colorId;
        } else {
            candMap.set(key, {
                method, methodLabel,
                alias, rb: String(rb).trim(),
                colorId: colorId != null ? colorId : null,
                count: 1
            });
        }
    };

    for (const rec of records) {
        const colorId = (rec.color_id != null && rec.color_id !== '') ? Number(rec.color_id) : null;

        // direct：直接RB匹配
        try {
            const rb = await getPartByNum(num);
            if (rb) addCandidate('direct', '直接RB匹配', num, colorId);
        } catch (e) { /* 忽略 */ }

        // alias：别名解析
        try {
            const resolved = await resolvePartAlias(num);
            if (resolved && String(resolved).trim() !== num) {
                const rb = await getPartByNum(String(resolved).trim());
                if (rb) addCandidate('alias', '别名映射', String(resolved).trim(), colorId);
            }
        } catch (e) { /* 忽略 */ }

        // bl：BL匹配
        try {
            let colorName = null;
            if (colorId != null) {
                try {
                    const c = await getColorById(colorId);
                    if (c && c.name) colorName = c.name;
                } catch (e2) { /* 忽略 */ }
            }
            const m = await matchRBByColorFallback(num, colorName);
            if (m && m.rbPartNum) {
                addCandidate('bl', 'BL匹配', String(m.rbPartNum).trim(), (m.colorId != null ? Number(m.colorId) : colorId));
            }
        } catch (e) { /* 忽略 */ }
    }

    const candidates = [...candMap.values()];

    // 3. 无任何候选
    if (!candidates.length) {
        resultEl.innerHTML = `
            <div style="color:#e53935;text-align:center;padding:16px 0;">型号 <b>${num}</b> 未找到可用的匹配配对（直接/别名/BL 均未命中）</div>
            <div style="color:#999;text-align:center;font-size:12px;">系统中匹配到 <b>${records.length}</b> 条该型号记录</div>
        `;
        return;
    }

    // 4. 渲染候选列表（radio 选择）+ 直接匹配RB（删除别名）选项
    const cards = candidates.map((c, i) => {
        const current = c.method === 'alias' ? '（当前该型号已有此别名映射）' : '';
        const colorPart = c.colorId != null ? `<div style="font-size:11px;color:#999;">颜色ID：${c.colorId}</div>` : '';
        return `
            <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #E0E0E0;border-radius:8px;margin-bottom:8px;cursor:pointer;background:#FAFAFA;">
                <input type="radio" name="bl-batch-choice" value="pair:${i}" style="width:16px;height:16px;">
                <div style="flex:1;">
                    <div style="font-size:13px;">
                        <span style="font-weight:600;">${num}</span>
                        <span style="color:#bbb;"> → </span>
                        <span style="font-weight:700;color:#2E7D32;">${c.rb}</span>
                        <span style="font-size:11px;color:#1976D2;margin-left:6px;">${c.methodLabel}</span>${current}
                    </div>
                    <div style="font-size:12px;color:#666;">出现在 <b>${c.count}</b> 条该型号记录中${c.rb === num ? '，即直接匹配RB自身' : ''}</div>
                    ${colorPart}
                </div>
            </label>
        `;
    }).join('');

    // 直接匹配RB（删除别名）选项
    const directOption = `
        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #CDDC39;border-radius:8px;margin-bottom:8px;cursor:pointer;background:#F9FBE7;">
            <input type="radio" name="bl-batch-choice" value="direct" style="width:16px;height:16px;">
            <div style="flex:1;">
                <div style="font-size:13px;"><span style="font-weight:700;color:#558B2F;">直接匹配RB（${num} → ${num}）</span></div>
                <div style="font-size:12px;color:#666;">不使用别名映射；若已存在 ${num} 的别名，将同时删除该别名记录</div>
            </div>
        </label>
    `;

    resultEl.innerHTML = `
        <div style="font-size:12px;color:#999;margin-bottom:8px;">找到 <b>${records.length}</b> 条型号为 <b>${num}</b> 的记录，共 <b>${candidates.length}</b> 种匹配配对（不去重，全部列出），请选择要采用的配对：</div>
        ${cards}
        ${directOption}
        <div style="display:flex;gap:8px;margin-top:12px;">
            <button id="bl-batch-cancel" style="flex:1;padding:10px;border:none;border-radius:6px;background:#607D8B;color:#fff;font-size:14px;cursor:pointer;">取消</button>
            <button id="bl-batch-confirm" style="flex:2;padding:10px;border:none;border-radius:6px;background:#2196F3;color:#fff;font-size:14px;cursor:pointer;">确认并更新别名</button>
        </div>
    `;

    const confirmBtn = resultEl.querySelector('#bl-batch-confirm');
    const cancelBtn = resultEl.querySelector('#bl-batch-cancel');
    cancelBtn.onclick = () => {
        resultEl.querySelectorAll('input[name="bl-batch-choice"]').forEach(r => r.checked = false);
    };

    confirmBtn.onclick = async () => {
        const checked = resultEl.querySelector('input[name="bl-batch-choice"]:checked');
        if (!checked) {
            alert('请先选择一个配对或选择直接匹配RB');
            return;
        }
        confirmBtn.disabled = true;
        const val = checked.value;
        try {
            if (val === 'direct') {
                // 删除别名映射
                const r = await deletePartAlias(num);
                if (r.skipped) {
                    showToast(`型号 ${num} 本就无别名映射，无需更改`, 2200);
                } else {
                    showToast(r.ok ? `已删除别名 ${num}（直接匹配RB）` : `删除别名 ${num} 部分失败`, 2500);
                }
            } else {
                // 采用某一配对 → 新增/变更该别名
                const idx = Number(val.replace('pair:', ''));
                const c = candidates[idx];
                if (!c) { alert('配对数据无效'); return; }
                const r = await persistPartAlias(c.alias, c.rb);
                showToast(r.ok ? `已更新别名 ${c.alias} → ${c.rb}` : `更新别名 ${c.alias} → ${c.rb} 部分失败`, 2500);
            }
            // 刷新缓存，让后续解析立即生效
            clearPartAliasesCache();
        } catch (e) {
            console.warn('[批量BL重配]更新失败:', e);
            alert('更新别名失败：' + (e.message || '未知错误'));
        } finally {
            confirmBtn.disabled = false;
        }
    };
}

// 匹配型号到 RB：返回 { inputNum, matchedPartNum, method, rbPart, colorId, colorName }
//   method: 'direct' 直接RB匹配 | 'alias' 别名解析 | 'bl' BL匹配 | null 未命中
async function matchPartNumToRB(partNum, colorId) {
    const input = String(partNum == null ? '' : partNum).trim();
    const out = {
        inputNum: input,
        matchedPartNum: null,
        method: null,
        rbPart: null,
        colorId: (colorId != null && colorId !== '') ? colorId : null,
        colorName: null
    };
    if (!input) return out;

    // a) 直接 RB 匹配
    try {
        const rbPart = await getPartByNum(input);
        if (rbPart) {
            out.matchedPartNum = input;
            out.rbPart = rbPart;
            out.method = 'direct';
            return out;
        }
    } catch (e) { /* 忽略 */ }

    // b) 别名解析
    try {
        const resolved = await resolvePartAlias(input);
        if (resolved && String(resolved).trim() !== input) {
            const rbPart = await getPartByNum(String(resolved).trim());
            if (rbPart) {
                out.matchedPartNum = String(resolved).trim();
                out.rbPart = rbPart;
                out.method = 'alias';
                return out;
            }
        }
    } catch (e) { /* 忽略 */ }

    // c) BL 匹配（需要颜色名）
    let colorName = null;
    try {
        if (out.colorId != null) {
            const c = await getColorById(out.colorId);
            if (c && c.name) colorName = c.name;
            if (!colorName) {
                const ci = await getColorInfo(out.colorId);
                if (ci && ci.name) colorName = ci.name;
            }
        }
    } catch (e) { /* 忽略 */ }
    try {
        const m = await matchRBByColorFallback(input, colorName);
        if (m && m.rbPartNum) {
            out.matchedPartNum = String(m.rbPartNum).trim();
            out.method = 'bl';
            if (m.colorId != null) {
                out.colorId = m.colorId;
                try {
                    const cl = await getColorById(m.colorId);
                    if (cl && cl.name) out.colorName = cl.name;
                } catch (e) { /* 忽略 */ }
            }
            try {
                out.rbPart = await getPartByNum(out.matchedPartNum);
            } catch (e) {
                out.rbPart = null;
            }
            return out;
        }
    } catch (e) { /* 忽略 */ }

    return out;
}

// 主流程：匹配 → 展示 → 确认 → 更新零件基本信息 + 别名映射
async function reconfigurePartBLMatch(part) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    const sheet = document.createElement('div');
    sheet.className = 'modal-content';
    sheet.style.maxWidth = '360px';
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const render = (html) => { sheet.innerHTML = html; };
    render(`
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span class="modal-title" style="font-size:16px;font-weight:600;">BL重配</span>
            <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()" style="background:#f44336;color:white;padding:6px 14px;font-size:13px;border:none;border-radius:4px;cursor:pointer;">关闭</button>
        </div>
        <div class="modal-body" id="bl-rec-body" style="text-align:center;color:#888;padding:20px 0;">正在重新匹配型号…</div>
    `);
    const bodyEl = sheet.querySelector('#bl-rec-body');

    // —— 1. 执行匹配 ——
    const result = await matchPartNumToRB(part.part_num, part.color_id);

    // —— 2. 未命中 ——
    if (!result.matchedPartNum) {
        bodyEl.innerHTML = `
            <div style="color:#e53935;font-size:15px;margin-bottom:8px;">未能匹配到RB型号</div>
            <div style="font-size:13px;color:#666;">型号：${part.part_num}${part.color_id != null ? ' · 颜色ID：' + part.color_id : ''}</div>
            <div style="font-size:12px;color:#999;margin-top:8px;">直接RB匹配、别名解析、BL匹配均未命中。</div>
        `;
        return;
    }

    // —— 3. 组装展示信息 ——
    let name = result.rbPart && result.rbPart.name ? result.rbPart.name : '';
    let colorName = result.colorName;
    if (!colorName && result.colorId != null) {
        try {
            const cl = await getColorById(result.colorId);
            if (cl && cl.name) colorName = cl.name;
        } catch (e) { /* 忽略 */ }
    }
    let imgUrl = null;
    try {
        imgUrl = await getPartImageUrl(result.matchedPartNum, result.colorId);
    } catch (e) {
        imgUrl = null;
    }

    const methodLabel = result.method === 'direct' ? '直接RB匹配'
        : result.method === 'alias' ? '别名映射'
        : result.method === 'bl' ? 'BL匹配' : '';
    const colorText = colorName
        ? `${colorName}（ID：${result.colorId}）`
        : (result.colorId != null ? `ID：${result.colorId}` : '（无）');

    bodyEl.innerHTML = `
        <div style="display:flex;justify-content:center;align-items:center;gap:16px;margin-bottom:10px;">
            <div style="text-align:center;">
                <div style="font-size:11px;color:#999;">原型号</div>
                <div style="font-size:15px;font-weight:600;">${part.part_num}</div>
            </div>
            <div style="font-size:18px;color:#bbb;">→</div>
            <div style="text-align:center;">
                <div style="font-size:11px;color:#999;">匹配型号</div>
                <div style="font-size:15px;font-weight:700;color:#2E7D32;">${result.matchedPartNum}</div>
            </div>
        </div>
        <div style="text-align:center;font-size:12px;color:#1976D2;margin-bottom:10px;">匹配方式：${methodLabel}</div>
        ${imgUrl ? `<div style="display:flex;justify-content:center;margin-bottom:10px;"><img src="${imgUrl}" alt="${result.matchedPartNum}" style="max-width:120px;max-height:120px;border-radius:6px;background:#f5f5f5;" onerror="this.style.display='none'"/></div>` : ''}
        ${imgUrl ? `<div style="background:#f5f5f5;border:1px solid #ddd;border-radius:6px;padding:8px;word-break:break-all;font-size:11px;color:#555;margin-bottom:10px;">图片URL：${imgUrl}</div>` : ''}
        <div style="text-align:left;font-size:13px;line-height:1.9;">
            <div><b>名称：</b>${name || '（无）'}</div>
            <div><b>颜色：</b>${colorText}</div>
        </div>
        <div style="font-size:12px;color:#999;margin-top:12px;">原BL型号将保持不变，匹配结果用于修正名称/颜色并写入别名映射</div>
        <div style="display:flex;gap:8px;margin-top:12px;">
            <button id="bl-rec-cancel" style="flex:1;padding:9px;border:none;border-radius:6px;background:#607D8B;color:#fff;font-size:14px;cursor:pointer;">取消</button>
            <button id="bl-rec-confirm" style="flex:2;padding:9px;border:none;border-radius:6px;background:#2196F3;color:#fff;font-size:14px;cursor:pointer;">确认更新</button>
        </div>
    `;

    bodyEl.querySelector('#bl-rec-cancel').onclick = () => overlay.remove();
    bodyEl.querySelector('#bl-rec-confirm').onclick = async () => {
        const btn = bodyEl.querySelector('#bl-rec-confirm');
        btn.disabled = true;
        try {
            await applyRematchToPart(part, result);
            // 关闭 BL重配 弹窗
            overlay.remove();
            // 刷新零件详情（型号 / 图片等）：读取最新数据后重新打开详情弹窗
            try {
                const fresh = await getPartById(part.id);
                // 先移除旧的零件详情弹窗，避免叠加
                document.querySelectorAll('.part-detail-modal').forEach(m => {
                    const ov = m.closest('.modal-overlay');
                    if (ov) ov.remove();
                });
                if (fresh) {
                    await showPartDetail(fresh);
                }
            } catch (e2) {
                console.warn('BL重配后刷新零件详情失败:', e2);
            }
            // 刷新盒子零件列表
            if (selectedBox) {
                await loadParts(selectedBox.id);
            }
            showToast('BL重配完成');
        } catch (e) {
            console.warn('BL重配失败:', e);
            alert(e.message || '保存失败');
        }
    };
}

// 确认后：更新零件基本信息 + 处理别名映射
async function applyRematchToPart(part, result) {
    // 保留原BL型号（不改写 part_num），仅依据匹配结果修正名称/颜色，RB 关系交给别名映射
    const newPartNum = String(result.matchedPartNum).trim();
    const updateData = {};
    if (result.rbPart && result.rbPart.name && result.rbPart.name !== part.name) {
        updateData.name = result.rbPart.name;
    }
    const newColorId = result.colorId != null ? Number(result.colorId) : null;
    if (newColorId != null && String(newColorId) !== String(part.color_id)) {
        updateData.color_id = newColorId;
    }
    if (Object.keys(updateData).length) {
        const ok = await updatePart(part.id, updateData);
        if (!ok) {
            throw new Error('更新零件基本信息失败');
        }
    }

    // —— 别名映射处理（原BL型号 → 匹配到的RB型号）——
    await handleAliasAfterRematch(String(part.part_num).trim(), newPartNum);
}

// 别名映射：查记录 → 无则新增 / 有则比较（相同返回 / 不同让用户选择后更新）
// 数据源统一为 RB 离线数据库别名表；更新时通过 persistPartAlias 同时写回 RB库 + Gitee CSV
async function handleAliasAfterRematch(aliasNum, rbNum) {
    if (!aliasNum || !rbNum || aliasNum === rbNum) {
        console.log('[BL重配] 直接匹配RB，无需别名映射');
        return true;
    }

    // 查询现有记录（RB 离线数据库 / 历史 localStorage，代替 Supabase）
    let existing = null;
    try {
        const aliases = await getAllPartAliases();
        if (aliases && aliases[aliasNum]) {
            existing = { alias_part_num: aliasNum, rb_part_num: String(aliases[aliasNum]) };
        }
    } catch (e) {
        console.warn('[BL重配]查询别名记录失败:', e.message);
    }

    // 无记录 → 添加保存
    if (!existing) {
        const r = await persistPartAlias(aliasNum, rbNum);
        console.log(`[BL重配]已新增别名: ${aliasNum} → ${rbNum}`, r);
        return !!r.ok;
    }

    // 有记录 → 比较
    const existingRb = String(existing.rb_part_num).trim();
    if (existingRb === rbNum) {
        console.log('[BL重配]别名已有且一致，无需更新');
        return true; // 相同 → 返回
    }

    // 不同 → 对比后让用户选择确认，再更新
    const choice = await showAliasDiffConfirm(aliasNum, existingRb, rbNum);
    if (choice !== 'update') {
        console.log('[BL重配]用户保持原别名，未更新');
        return true;
    }
    const r = await persistPartAlias(aliasNum, rbNum);
    console.log(`[BL重配]已更新别名: ${aliasNum} → ${rbNum}`, r);
    if (!r.ok) {
        alert('更新别名映射失败');
        return false;
    }
    return true;
}

// 别名差异对比弹窗：返回 'update' 或 'keep'
function showAliasDiffConfirm(aliasNum, oldRb, newRb) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        const sheet = document.createElement('div');
        sheet.className = 'modal-content';
        sheet.style.maxWidth = '340px';
        sheet.innerHTML = `
            <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <span class="modal-title" style="font-size:16px;font-weight:600;">别名映射差异</span>
            </div>
            <div class="modal-body">
                <div style="font-size:13px;color:#666;margin-bottom:10px;">型号 <b>${aliasNum}</b> 已存在别名映射，与新匹配结果不一致：</div>
                <div style="background:#FFF3E0;border:1px solid #FFE0B2;border-radius:6px;padding:10px;font-size:13px;margin-bottom:6px;">
                    <div>现有映射：<b>${aliasNum} → ${oldRb}</b></div>
                </div>
                <div style="background:#E3F2FD;border:1px solid #BBDEFB;border-radius:6px;padding:10px;font-size:13px;margin-bottom:14px;">
                    <div>新匹配：<b>${aliasNum} → ${newRb}</b></div>
                </div>
                <div style="display:flex;gap:8px;">
                    <button id="al-diff-keep" style="flex:1;padding:9px;border:none;border-radius:6px;background:#607D8B;color:#fff;font-size:14px;cursor:pointer;">保持现有</button>
                    <button id="al-diff-update" style="flex:1;padding:9px;border:none;border-radius:6px;background:#2196F3;color:#fff;font-size:14px;cursor:pointer;">更新为新匹配</button>
                </div>
            </div>
        `;
        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve('keep');
            }
        });
        sheet.querySelector('#al-diff-keep').onclick = () => {
            overlay.remove();
            resolve('keep');
        };
        sheet.querySelector('#al-diff-update').onclick = () => {
            overlay.remove();
            resolve('update');
        };
    });
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
        
        // 缩放到 192x192 JPG
        const resizedDataUrl = await resizeImageTo192(imageBase64);
        
        // ① 保存到浏览器离线缓存
        await savePartImageToOfflineCache(partNum, colorId, resizedDataUrl);
        // ② 上传到 Gitee Parts-img
        const uploadResult = await uploadPartImageToGitee(partNum, colorId, resizedDataUrl);
        
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

// 将图片缩放到 192x192 JPG（居中裁剪为正方形再缩放）
async function resizeImageTo192(imageDataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 192;
                canvas.height = 192;
                const ctx = canvas.getContext('2d');
                // 居中裁剪为正方形：取原图宽高的较小值作为正方形边长
                const size = Math.min(img.width, img.height);
                const sx = (img.width - size) / 2;
                const sy = (img.height - size) / 2;
                ctx.drawImage(img, sx, sy, size, size, 0, 0, 192, 192);
                resolve(canvas.toDataURL('image/jpeg', 0.92));
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = imageDataUrl;
    });
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
        statusEl.textContent = '⏳ 正在处理图片（缩放到192x192）...';
        statusEl.style.color = '#2196F3';
        
        // 缩放到 192x192 JPG
        const resizedDataUrl = await resizeImageTo192(imageDataUrl);
        
        // ① 保存到浏览器离线缓存
        await savePartImageToOfflineCache(partNum, colorId, resizedDataUrl);
        // ② 上传到 Gitee Parts-img
        const uploadResult = await uploadPartImageToGitee(partNum, colorId, resizedDataUrl);
        
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

// 更新图片：强制加载线上图片（RB优先，无则Gitee）覆盖离线缓存中的原图
// 遵循离线图片命名规则（buildPartsImgUrl: parts/{partNum}_{colorId}.jpg）
async function updatePartImageSource(partNum, colorId) {
    showToast('🔄 正在加载线上图片覆盖离线缓存...');
    try {
        // ① RB 数据库图片
        let rbUrls = [];
        try { rbUrls = await getRBPartImageUrls(partNum, colorId); } catch (e) {}
        let url = Array.isArray(rbUrls) && rbUrls.length ? rbUrls[0] : null;
        let source = 'RB';

        // ② Gitee 图片
        if (!url) {
            let giteeOk = false;
            try { giteeOk = await checkPartsImgOnGitee(partNum, colorId); } catch (e) {}
            if (giteeOk) {
                url = buildPartsImgUrl(partNum, colorId);
                source = 'Gitee';
            }
        }

        if (!url) {
            showToast('⚠️ 未找到RB/Gitee在线图片');
            return;
        }

        // ③ 下载图片（优先 CORS，失败回退 no-cors）
        let response;
        try {
            response = await fetch(url);
        } catch (_) {
            response = await fetch(url, { mode: 'no-cors' });
        }
        if (!response) {
            showToast('⚠️ 图片加载失败');
            return;
        }

        // ④ 覆盖写入离线缓存（缓存.put 相同 key 会覆盖原图）
        const ok = await savePartImageToOfflineCache(partNum, colorId, response);
        if (!ok) {
            showToast('⚠️ 离线缓存写入失败');
            return;
        }

        showToast(`✅ 已用${source}图片更新离线缓存`);
        await closeManageModalAndRefresh(partNum, colorId);
    } catch (e) {
        console.error('更新图片失败:', partNum, colorId, e);
        showToast('⚠️ 更新图片失败: ' + e.message);
    }
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
                <button onclick="updatePartImageSource('${partNum}', ${colorId})" style="flex:1;padding:8px;background:#FF9800;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;">更新图片</button>
                <button onclick="changeCustomImage('${partNum}', ${colorId})" style="flex:1;padding:8px;background:#2196F3;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;">替换图片</button>
                <button onclick="deleteCustomImageWithOptions('${partNum}', ${colorId})" style="flex:1;padding:8px;background:#f44336;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;">删除图片</button>
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

// 删除自定义图片：弹窗选择 仅删除离线图片 / 删除 Gitee 图片
function deleteCustomImageWithOptions(partNum, colorId) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    const box = document.createElement('div');
    box.className = 'modal-content';
    box.style.cssText = 'max-width:320px;padding:20px;text-align:center;';
    box.innerHTML = `
        <div style="margin-bottom:16px;font-size:16px;font-weight:bold;">选择删除方式</div>
        <div style="margin-bottom:20px;font-size:14px;color:#888;">${partNum}_${colorId}.jpg</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
            <button id="del-offline-img" style="padding:12px;border:none;border-radius:8px;background:#ff9800;color:#fff;font-size:14px;cursor:pointer;">仅删除离线图片</button>
            <button id="del-gitee-img" style="padding:12px;border:none;border-radius:8px;background:#f44336;color:#fff;font-size:14px;cursor:pointer;">删除 Gitee 图片</button>
            <button id="del-img-cancel" style="padding:10px;border:none;border-radius:8px;background:#666;color:#fff;font-size:14px;cursor:pointer;">取消</button>
        </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    box.querySelector('#del-offline-img').onclick = () => {
        overlay.remove();
        deleteCustomOfflineImage(partNum, colorId);
    };
    box.querySelector('#del-gitee-img').onclick = () => {
        overlay.remove();
        deleteCustomGiteeImage(partNum, colorId);
    };
    box.querySelector('#del-img-cancel').onclick = () => overlay.remove();
}

// 仅删除离线图片（保留Gitee云端图片），关闭管理弹窗并刷新详情
async function deleteCustomOfflineImage(partNum, colorId) {
    await deletePartImageFromOfflineCache(partNum, colorId);
    showToast('已删除离线图片，下次联网可重新加载');
    await closeManageModalAndRefresh(partNum, colorId);
}

// 删除 Gitee 图片 + 离线缓存 + RB 数据库记录，关闭管理弹窗并刷新详情
async function deleteCustomGiteeImage(partNum, colorId) {
    await deletePartImageFromOfflineCache(partNum, colorId);
    const giteeResult = await deletePartImageFromGitee(partNum, colorId);
    await clearPartImageUrlInRB(partNum, colorId);
    if (giteeResult && giteeResult.success === false && giteeResult.error && giteeResult.error !== '文件不存在，无需删除') {
        showToast('图片已删除，但云端(Gitee)删除失败，刷新后可能仍显示');
    } else {
        showToast('图片已删除');
    }
    await closeManageModalAndRefresh(partNum, colorId);
}

// 关闭当前管理弹窗并刷新零件详情
async function closeManageModalAndRefresh(partNum, colorId) {
    const overlay = document.querySelector('.modal-overlay.active');
    if (overlay) overlay.remove();
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
                if (val !== '') {
                    updateColorPickButton(val);
                } else {
                    updateColorPickButton('');
                }
            });
        }
        
        // 初始化并渲染"仓库"区域 A 的仓库卡片
        renderSearchSelectedRepos();
        
        // 监听弹窗（modal-overlay）的添加/移除，自动锁定/解锁 body 滚动
        const bodyObserver = new MutationObserver(() => {
            const hasActiveOverlay = document.querySelector('.modal-overlay.active');
            document.body.style.overflow = hasActiveOverlay ? 'hidden' : '';
        });
        bodyObserver.observe(document.body, { childList: true, subtree: true });
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
            // 升级场景：旧库无 BL 颜色表数据，补充加载 bl_colors.json
            try {
                const blColorsCount = await countRecords(RB_STORES.BL_COLORS);
                if (blColorsCount === 0) {
                    const blColorResult = await loadBLColorsToRBDB();
                    if (blColorResult.success) {
                        console.log(`补充加载 BL 颜色表: ${blColorResult.count}条`);
                    }
                }
            } catch (e) {
                console.warn('补充加载 BL 颜色表失败:', e.message);
            }
            // 加载型号英文词汇（ID_Abc.json）到离线缓冲区（非阻塞）
            loadIDAbcOnStartup();
            // 加载离线 Bricklink 价格库 BL-price.json → rb_prices（非阻塞，失败仅告警）
            if (typeof loadBLPriceLibraryToRBDb === 'function') {
                loadBLPriceLibraryToRBDb().then(r => {
                    if (r && r.success) console.log(`离线价格库补充加载: ${r.added}/${r.total} 条`);
                }).catch(e => console.warn('离线价格库补充加载失败:', e));
            }
            showRBStatusHint('rb-ready');
            return;
        }
        
        console.log('RB本地数据库不存在，从Parts-RB读取CSV文件建立...');
        
        // 从 Parts-RB 读取 7 个 CSV 文件
        const csvFiles = [
            { name: 'colors.csv', store: RB_STORES.COLORS, schemaKey: 'colors', label: '颜色' },
            { name: 'parts.csv', store: RB_STORES.PARTS, schemaKey: 'parts', label: '零件' },
            { name: 'part_categories.csv', store: RB_STORES.PART_CATEGORIES, schemaKey: 'part_categories', label: '类别' },
            { name: 'elements.csv', store: RB_STORES.ELEMENTS, schemaKey: 'elements', label: '元素' },
            { name: 'inventory_parts.csv', store: RB_STORES.INVENTORY_PARTS, schemaKey: 'inventory_parts', label: '库存' },
            { name: 'part_relationships.csv', store: RB_STORES.PART_RELATIONSHIPS, schemaKey: 'part_relationships', label: '关系' },
            { name: 'BL-parts.csv', store: RB_STORES.BL_PARTS, schemaKey: 'bl_parts', label: 'BL零件' }
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

        // 可选：加载 BL-parts（BG型号+颜色名→CODENAME），用于方法一兑底匹配。
        // 若仓库暂无 bl_parts.csv 或导入失败，不阻塞 RB 主库与 ready 状态。
        try {
            const blCsv = await fetchRBFile('BL-parts.csv');
            if (blCsv) {
                const { data } = parseRBCSV(blCsv);
                await importRBData(RB_STORES.BL_PARTS, convertRBData('bl_parts', data));
                console.log(`BL-parts 加载成功: ${data.length} 条`);
            }
        } catch (error) {
            console.warn('BL-parts 可选加载失败（不影响RB主库）:', error.message);
        }

        // 加载零件别名映射（part_aliases.csv → RB离线数据库 rb_part_aliases 表）
        try {
            const aliases = await loadPartAliasesFromGiteeToRBDB();
            console.log(`零件别名映射加载成功: ${Object.keys(aliases).length} 条`);
        } catch (error) {
            console.warn('零件别名映射加载失败（不影响RB主库）:', error.message);
        }

        // 可选：加载 BL 颜色表（bl_colors.json → rb_bl_colors），供颜色映射使用。
        // 若仓库暂无或导入失败，不阻塞 RB 主库与 ready 状态。
        try {
            const blColorResult = await loadBLColorsToRBDB();
            console.log(`BL 颜色表加载成功: ${blColorResult.count} 条`);
        } catch (error) {
            console.warn('BL 颜色表可选加载失败（不影响RB主库）:', error.message);
        }

        // 加载型号英文词汇（ID_Abc.json）到离线缓冲区（非阻塞）
        loadIDAbcOnStartup();
        // 加载离线 Bricklink 价格库 BL-price.json → rb_prices（非阻塞，失败仅告警）
        if (typeof loadBLPriceLibraryToRBDb === 'function') {
            loadBLPriceLibraryToRBDb().then(r => {
                if (r && r.success) console.log(`离线价格库加载: ${r.added}/${r.total} 条`);
            }).catch(e => console.warn('离线价格库加载失败:', e));
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

// ===== 型号英文词汇（ID_Abc.json）=====

// 遍历 BL-parts 表，抽取 ITEMID 中的字母片段（英文词，含单个字母），按出现次数去重排序后
// 1) 推送到 Gitee parts-rb 仓库的 ID_Abc.json；2) 写入本地离线缓冲区 rb_id_abc。
async function buildIDAbcJson() {
    try {
        let blParts = [];
        try {
            blParts = await getAll(RB_STORES.BL_PARTS);
        } catch (e) {
            console.warn('读取 BL-parts 失败:', e.message);
        }
        if (!blParts || blParts.length === 0) {
            alert('BL-parts 数据为空，请先执行"更新RB"加载 BL-parts 后再生成词汇。');
            return;
        }

        // 统计每个字母片段在 ITEMID 中出现的次数
        const countMap = {};
        for (const row of blParts) {
            const itemId = String(row.ITEMID == null ? '' : row.ITEMID).trim();
            if (!itemId) continue;
            const matches = itemId.match(/[A-Za-z]+/g);
            if (!matches) continue;
            for (const m of matches) {
                const word = m.toLowerCase();
                countMap[word] = (countMap[word] || 0) + 1;
            }
        }

        const records = Object.keys(countMap)
            .map(word => ({ word, count: countMap[word] }))
            .sort((a, b) => (b.count - a.count) || a.word.localeCompare(b.word));

        if (records.length === 0) {
            alert('未从 BL-parts 中提取到任何英文词汇。');
            return;
        }

        // 1) 推送到 Gitee parts-rb
        await uploadIDAbcToGitee(records);
        // 2) 同步本地离线缓冲区
        await importIDAbcToRBDb(records);

        const preview = records.slice(0, 10).map(r => r.word).join('、');
        alert(`已生成 ${records.length} 个英文词汇并保存到 Gitee ID_Abc.json，同时更新了本地词库。\n\n高频示例：${preview}…`);
    } catch (error) {
        console.error('生成型号英文词汇失败:', error);
        alert('生成失败: ' + (error.message || error));
    }
}

// 启动时把 Gitee 的 ID_Abc.json 加载到本地离线缓冲区（非阻塞，失败不影响主流程）
async function loadIDAbcOnStartup() {
    try {
        const records = await fetchIDAbcJson();
        if (!records || records.length === 0) return;
        const result = await importIDAbcToRBDb(records);
        if (result.success) {
            console.log(`型号英文词汇离线缓冲区加载成功: ${result.count} 条`);
        }
    } catch (error) {
        console.warn('型号英文词汇离线加载失败（不影响主流程）:', error.message);
    }
}

// 在「零件清单」型号输入弹窗下半部内嵌英文词库（三行自动换行、垂直滚动）
async function initQ4IDAbcLibrary(overlay) {
    const wrapEl = overlay ? overlay.querySelector('#q4-popup-idabc-wrap') : null;
    if (!wrapEl) return;

    let records = await getIDAbcRecords();
    if (!records || records.length === 0) {
        try {
            records = await fetchIDAbcJson();
            if (records && records.length) await importIDAbcToRBDb(records);
        } catch (e) {
            records = [];
        }
    }

    if (!records || records.length === 0) {
        wrapEl.innerHTML = '<div class="id-abc-empty">英文词汇库为空（可在系统设置-其他-型号英文生成）</div>';
        return;
    }

    // 按 ID_Abc 顺序显示
    const words = records.map(r => r.word);
    wrapEl.innerHTML = words.map(w =>
        `<span class="id-abc-chip" data-word="${w}">${w}</span>`
    ).join('');

    // 点选词后填入型号输入框
    const input = overlay.querySelector('#q4-popup-input');
    wrapEl.querySelectorAll('.id-abc-chip').forEach(el => {
        el.addEventListener('click', () => {
            const word = el.getAttribute('data-word');
            if (input) {
                input.value = (input.value || '') + word;
                input.focus();
            }
        });
    });
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

// 别名映射：遍历离线缓冲区（IndexedDB RB_Database）的 BL-parts 表，
// 用 CODENAME 匹配 elements 表 element_id 得到 RB 型号 part_num，与 ITEMID 比对；
// 相同则直接匹配无需处理，不同则生成 (ITEMID, part_num) 别名对 →
// 去重（ITEMID 与 part_num 同时相同）→ 写入离线缓冲区临时文件 AL.json →
// 确认后合并写入 Gitee parts-rb 仓库 part_aliases.csv（跳过已有）→ 提示执行"更新RB"
async function generateAliasMapping() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width: 440px; text-align: center;">
            <div class="modal-header">
                <span class="modal-title">别名映射</span>
            </div>
            <div class="modal-body">
                <div id="al-progress" style="padding: 5px 0;">
                    <div class="rb-progress-bar" style="background: #e0e0e0; border-radius: 10px; height: 20px; overflow: hidden; margin: 10px 0;">
                        <div id="al-progress-fill" style="background: #9C27B0; height: 100%; width: 0%; transition: width 0.3s;"></div>
                    </div>
                    <div id="al-progress-text" style="font-size: 14px; color: #666; margin-top: 10px;">准备分析...</div>
                    <div id="al-progress-detail" style="font-size: 12px; color: #999; margin-top: 5px;"></div>
                </div>
                <div id="al-result" style="display: none;"></div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const updateProgress = (percent, text, detail) => {
        const fill = document.getElementById('al-progress-fill');
        const textEl = document.getElementById('al-progress-text');
        const detailEl = document.getElementById('al-progress-detail');
        if (fill) fill.style.width = Math.round(percent * 100) + '%';
        if (text && textEl) textEl.textContent = text;
        if (detail && detailEl) detailEl.textContent = detail;
    };

    try {
        // 1. 读取离线缓冲区（IndexedDB RB_Database）的 BL-parts 与 elements 表
        updateProgress(0.05, '读取离线 BL-parts / elements 数据...', 'RB_Database');
        const [blParts, elements] = await Promise.all([
            getAll(RB_STORES.BL_PARTS).catch(() => []),
            getAll(RB_STORES.ELEMENTS).catch(() => [])
        ]);
        if (!blParts.length) throw new Error('离线数据库无 BL-parts 数据，请先点击"更新RB"导入');
        if (!elements.length) throw new Error('离线数据库无 elements 数据，请先点击"更新RB"导入');

        // 2. 构建 element_id → part_num 映射（element_id 为数字主键）
        updateProgress(0.2, '构建 element_id → part_num 映射...', `${elements.length} 条`);
        const elMap = new Map();
        for (const el of elements) {
            if (el.element_id != null && el.part_num != null) elMap.set(el.element_id, String(el.part_num).trim());
        }

        // 3. 遍历 BL-parts：CODENAME → element_id → part_num，与 ITEMID 比对
        updateProgress(0.35, '遍历 BL-parts 匹配 RB 型号...', `${blParts.length} 条`);
        const alPairs = [];
        let directMatched = 0, noMatch = 0;
        for (const row of blParts) {
            const itemId = String(row.ITEMID == null ? '' : row.ITEMID).trim();
            if (!itemId) continue;
            // CODENAME 为数字字符串（对应 element_id 数字主键），兼容号码边界/前导零
            const rawCode = String(row.CODENAME == null ? '' : row.CODENAME).trim();
            if (rawCode === '') { noMatch++; continue; }
            const numCode = Number(rawCode);
            const elKey = (!isNaN(numCode) && rawCode !== '') ? numCode : rawCode;
            const rb = elMap.get(elKey);
            if (rb == null) { noMatch++; continue; }
            if (rb === itemId) { directMatched++; continue; } // 2.1 直接匹配，无需处理
            alPairs.push({ ITEMID: itemId, part_num: rb });    // 2.2 需要别名映射
        }

        // 4. 去重（ITEMID 与 part_num 同时相同才去重）
        updateProgress(0.6, '去重...', `${alPairs.length} → ...`);
        const seen = new Set();
        const alDedup = [];
        for (const p of alPairs) {
            const key = p.ITEMID + '\u0000' + p.part_num;
            if (!seen.has(key)) { seen.add(key); alDedup.push(p); }
        }

        // 5. 写入离线缓冲区临时文件 AL.json
        updateProgress(0.75, '写入离线缓冲区临时文件 AL.json...', `${alDedup.length} 条`);
        localStorage.setItem('AL.json', JSON.stringify(alDedup));

        // 6. 展示分析结果并确认是否写入 Gitee
        updateProgress(1, '分析完成！', '');
        const stats = {
            blCount: blParts.length,
            elCount: elements.length,
            directMatched,
            noMatch,
            needAlias: alPairs.length,
            dedupCount: alDedup.length,
            alDedup
        };
        showAliasMappingConfirm(overlay, stats);
    } catch (error) {
        console.error('别名映射分析失败:', error);
        updateProgress(1, '分析失败', '');
        setTimeout(() => {
            const resultDiv = document.getElementById('al-result');
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `
                <div style="padding: 15px; margin-top: 10px; color: #f44336;">
                    <div style="font-size: 16px; margin-bottom: 10px;">✗ 分析失败</div>
                    <div style="font-size: 12px; margin: 10px 0; word-break: break-all;">${error.message}</div>
                    <button class="btn-save" style="margin-top: 15px;" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                </div>
            `;
        }, 500);
    }
}

// 别名映射确认弹窗：展示匹配/去重结果，确认后写入 Gitee
function showAliasMappingConfirm(overlay, stats) {
    const resultDiv = overlay.querySelector('#al-result');
    resultDiv.style.display = 'block';

    if (stats.dedupCount === 0) {
        // 无需映射：仅提示，无需写入 Gitee
        resultDiv.innerHTML = `
            <div style="padding: 15px; margin-top: 10px;">
                <div style="font-size: 16px; margin-bottom: 10px;">✓ 分析完成</div>
                <div style="font-size: 12px; color: #666; text-align: left; line-height: 1.8;">
                    <div>BL-parts 行数：${stats.blCount} 条</div>
                    <div>elements 行数：${stats.elCount} 条</div>
                    <div>直接匹配（ITEMID = part_num）：${stats.directMatched} 条</div>
                    <div>CODENAME 未匹配到 RB：${stats.noMatch} 条</div>
                    <div style="margin-top: 4px;">无需别名映射，AL.json 已生成（空）</div>
                </div>
                <button class="btn-save" style="margin-top: 15px;" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        `;
        return;
    }

    resultDiv.innerHTML = `
        <div style="padding: 15px; margin-top: 10px;">
            <div style="font-size: 16px; margin-bottom: 10px;">✓ 分析完成</div>
            <div style="font-size: 12px; color: #666; text-align: left; line-height: 1.8;">
                <div>BL-parts 行数：${stats.blCount} 条</div>
                <div>elements 行数：${stats.elCount} 条</div>
                <div>直接匹配（ITEMID = part_num）：${stats.directMatched} 条</div>
                <div>CODENAME 未匹配到 RB：${stats.noMatch} 条</div>
                <div>需别名映射（匹配数量）：${stats.needAlias} 条</div>
                <div>去重后数量：${stats.dedupCount} 条</div>
                <div style="margin-top: 4px;">AL.json 已生成并保存至离线缓冲区</div>
            </div>
            <div style="font-size: 12px; color: #999; margin-top: 10px; text-align: left; line-height: 1.6;">
                确认后将去重后的别名数据合并写入 Gitee parts-rb 仓库的 part_aliases.csv，
                已有相同数据会自动略过。
            </div>
            <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
                <button class="btn-save" id="al-write-start" style="padding: 8px 24px;">开始写入Gitee</button>
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">取消</button>
            </div>
        </div>
    `;
    overlay.querySelector('#al-write-start').onclick = () => doWriteAliasMappingToGitee(overlay, stats);
}

// 执行：将 AL.json 数据合并写入 Gitee part_aliases.csv（跳过已有），完成后提示执行"更新RB"
async function doWriteAliasMappingToGitee(overlay, stats) {
    const progressDiv = overlay.querySelector('#al-progress');
    const resultDiv = overlay.querySelector('#al-result');
    progressDiv.style.display = 'block';
    resultDiv.style.display = 'none';
    const fill = overlay.querySelector('#al-progress-fill');
    const textEl = overlay.querySelector('#al-progress-text');
    const detailEl = overlay.querySelector('#al-progress-detail');
    fill.style.width = '0%';
    const updateProgress = (percent, text, detail) => {
        fill.style.width = Math.round(percent * 100) + '%';
        if (text) textEl.textContent = text;
        if (detail) detailEl.textContent = detail;
    };

    try {
        updateProgress(0.1, '读取 Gitee part_aliases.csv...', 'parts-rb 仓库');
        const res = await mergeAliasesToPartAliasesCSV(stats.alDedup, 'BL匹配');

        updateProgress(1, '写入完成！', '');
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `
            <div style="padding: 15px; margin-top: 10px;">
                <div style="font-size: 16px; margin-bottom: 10px;">✓ 已写入 Gitee</div>
                <div style="font-size: 12px; color: #666; text-align: left; line-height: 1.8;">
                    <div>新增别名：${res.added} 条</div>
                    <div>跳过已有：${res.skipped} 条</div>
                    <div>part_aliases.csv 当前共 ${res.total} 条</div>
                </div>
                <div style="font-size: 13px; color: #9C27B0; margin: 12px 0; font-weight: bold;">请点击"更新RB"，将新别名导入本地离线数据库生效</div>
                <button class="btn-save" style="margin-top: 10px;" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        `;
    } catch (error) {
        console.error('写入 Gitee part_aliases.csv 失败:', error);
        updateProgress(1, '写入失败', error.message);
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `
            <div style="padding: 15px; margin-top: 10px; color: #f44336;">
                <div style="font-size: 16px; margin-bottom: 10px;">✗ 写入 Gitee 失败</div>
                <div style="font-size: 12px; margin: 10px 0; word-break: break-all;">${error.message}</div>
                <div style="font-size: 12px; color: #666; margin-top: 6px;">AL.json 已保存在离线缓冲区，可稍后重试。</div>
                <button class="btn-save" style="margin-top: 15px;" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        `;
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
        // 1. 从 Parts-RB 读取 7 个 CSV 文件
        updateProgress(0.05, '从Parts-RB仓库读取CSV文件...', '');
        
        const csvFiles = [
            { name: 'colors.csv', store: RB_STORES.COLORS, schemaKey: 'colors', label: '颜色' },
            { name: 'parts.csv', store: RB_STORES.PARTS, schemaKey: 'parts', label: '零件' },
            { name: 'part_categories.csv', store: RB_STORES.PART_CATEGORIES, schemaKey: 'part_categories', label: '类别' },
            { name: 'elements.csv', store: RB_STORES.ELEMENTS, schemaKey: 'elements', label: '元素' },
            { name: 'inventory_parts.csv', store: RB_STORES.INVENTORY_PARTS, schemaKey: 'inventory_parts', label: '库存' },
            { name: 'part_relationships.csv', store: RB_STORES.PART_RELATIONSHIPS, schemaKey: 'part_relationships', label: '关系' },
            { name: 'BL-parts.csv', store: RB_STORES.BL_PARTS, schemaKey: 'bl_parts', label: 'BL零件' }
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

        // 可选：加载 BL-parts（BG型号+颜色名→CODENAME），用于方法一兑底匹配
        try {
            updateProgress(0.83, '读取BL-parts数据...', 'bl_parts.csv');
            const blCsv = await fetchRBFile('BL-parts.csv');
            if (blCsv) {
                const { data } = parseRBCSV(blCsv);
                await importRBData(RB_STORES.BL_PARTS, convertRBData('bl_parts', data));
                importResults['bl_parts'] = true;
                updateProgress(0.88, 'BL-parts - 导入成功', `${data.length}条`);
            } else {
                importResults['bl_parts'] = false;
                updateProgress(0.88, 'BL-parts - 未提供', '');
            }
        } catch (error) {
            console.warn('BL-parts 可选加载失败:', error.message);
            importResults['bl_parts'] = false;
        }

        // 加载零件别名映射（part_aliases.csv → RB离线数据库 rb_part_aliases 表）
        try {
            updateProgress(0.91, '读取别名映射数据...', 'part_aliases.csv');
            const aliases = await loadPartAliasesFromGiteeToRBDB();
            importResults['part_aliases'] = true;
            updateProgress(0.95, '别名映射 - 导入成功', `${Object.keys(aliases).length}条`);
        } catch (error) {
            console.warn('零件别名映射加载失败（不影响RB主库）:', error.message);
            importResults['part_aliases'] = false;
        }

        // 可选：加载 BL 颜色表（bl_colors.json → rb_bl_colors）
        try {
            updateProgress(0.96, '读取 BL 颜色表...', 'bl_colors.json');
            const blColorResult = await loadBLColorsToRBDB();
            importResults['bl_colors'] = blColorResult.success;
            updateProgress(0.98, `BL 颜色表 - ${blColorResult.success ? '导入成功' : '导入失败'}`, `${blColorResult.count}条`);
        } catch (error) {
            console.warn('BL 颜色表加载失败（不影响RB主库）:', error.message);
            importResults['bl_colors'] = false;
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
            statsHtml += `<div>BL-parts: ${stats.rb_bl_parts || 0} 条</div>`;
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

// ========== 离线缓存零件图片 ==========

// 自动缓存零件图片到离线缓存（首次加载时触发）
// imgElement - 图片加载成功后的 <img> 元素，从 this.src 获取实际加载的图片URL
async function autoCachePartImage(partNum, colorId, imgElement) {
    try {
        const cached = await getPartImageFromOfflineCache(partNum, colorId);
        if (cached) return;
        if (!imgElement || !imgElement.src) return;
        // 优先尝试 CORS 模式获取完整响应
        // 若服务器不支持 CORS，再回退到 no-cors 模式获取不透明响应
        let response;
        try {
            response = await fetch(imgElement.src);
        } catch (_) {
            response = await fetch(imgElement.src, { mode: 'no-cors' });
        }
        if (response) {
            // 只有真正写入成功才提示成功，避免写入被拒收（如非图片响应）时仍谎称"已缓存"
            const ok = await savePartImageToOfflineCache(partNum, colorId, response);
            if (ok) {
                console.log('✅ 已写入离线缓存:', partNum, colorId, response.type + '/' + response.status, imgElement.src);
                showToast('✅ 图片已缓存到本地');
            } else {
                console.warn('零件图片未写入离线缓存（写入被拒收）:', partNum, colorId, response.type, response.status, 'reason=', _lastCacheWriteError);
            }
        }
    } catch (e) {
        // 静默失败，不影响用户使用
    }
}

// 立即尝试缓存图片（不等待 onload），在 showPartDetail 中调用
async function tryCachePartImage(partNum, colorId, url) {
    try {
        const cached = await getPartImageFromOfflineCache(partNum, colorId);
        if (cached) return;
        // 优先 CORS，失败回退 no-cors
        let response;
        try {
            response = await fetch(url);
        } catch (_) {
            response = await fetch(url, { mode: 'no-cors' });
        }
        if (response) {
            console.log('缓存图片响应:', partNum, colorId, 'type=', response.type, 'status=', response.status, 'url=', url);
            const ok = await savePartImageToOfflineCache(partNum, colorId, response);
            if (ok) {
                showToast('✅ 图片已离线缓存');
            } else if (_lastCacheWriteError && _lastCacheWriteError.indexOf('返回字节非图片') >= 0) {
                // 该色块图不存在于图床/数据库，或服务器返回了非图片（如 200 HTML 错误页/未识别新格式），
                // 属正常的变体缺失，静默跳过，不当作缓存失败报警
                console.warn('图片变体不可用，跳过缓存:', partNum, colorId, url, _lastCacheWriteError);
            } else {
                showToast('⚠️ 缓存写入失败 [' + response.type + '/' + response.status + (_lastCacheWriteError ? ' ' + _lastCacheWriteError : '') + ']');
                console.error('savePartImageToOfflineCache returned false', partNum, colorId, url, 'reason=', _lastCacheWriteError);
            }
        }
    } catch (e) {
        console.error('立即缓存失败:', partNum, colorId, url, e);
        showToast('⚠️ 缓存失败: ' + e.message);
    }
}

// 全局暴露，供 onload 属性调用
window.autoCachePartImage = autoCachePartImage;
window.tryCachePartImage = tryCachePartImage;

/* ============ 清单页面 ============ */
// 当前清单内容（零件数组），后续深化设计时作为数据源
let listParts = [];
// Q4 型号/颜色/数量状态（以标签展示，点击后弹窗输入）
let listModel = '';
let listColor = '';
let listQty = 1;

// 滚动锁定（输入法弹出时固定页面不移动）
let _scrollLockCount = 0;
function lockScroll() {
    _scrollLockCount++;
    if (_scrollLockCount === 1) {
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
    }
}
function unlockScroll() {
    if (_scrollLockCount > 0) _scrollLockCount--;
    if (_scrollLockCount === 0) {
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
    }
}

// 打开清单页面（Q1 标题+返回 / Q2 提示 / Q3 零件列表 / Q4 按钮区）
function openListPage() {
    if (document.getElementById('list-page-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active list-page-overlay';
    overlay.id = 'list-page-overlay';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeListPage();
    });

    overlay.innerHTML = `
        <div class="list-page">
            <div class="list-q1">
                <span class="list-title">零件清单</span>
                <button class="list-back-btn" onclick="closeListPage()">返回</button>
            </div>
            <div class="list-q2" id="list-q2">当前清单为空，可添加零件</div>
            <div class="list-q3" id="list-q3"></div>
            <div class="list-q4">
                <div class="q4-cell q4-model">
                    <div class="q4-top">
                        <span class="q4-label">型号</span>
                        <button class="q4-action" onclick="identifyModel()">识别</button>
                    </div>
                    <div class="q4-value-label" id="q4-model-val" onclick="editQ4Value('model')">—</div>
                </div>
                <div class="q4-cell q4-color">
                    <div class="q4-top">
                        <span class="q4-label">颜色</span>
                        <button class="q4-action" onclick="pickColor()">选色</button>
                    </div>
                    <div class="q4-value-label" id="q4-color-val" onclick="editQ4Value('color')">—</div>
                </div>
                <div class="q4-cell q4-qty">
                    <div class="q4-top">
                        <span class="q4-label">数量</span>
                    </div>
                    <div class="q4-value-label" id="q4-qty-val" onclick="editQ4Value('quantity')">1</div>
                </div>
                <div class="q4-add-cell">
                    <button class="q4-add-btn" onclick="addListPartFromSelector()">+</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    renderListParts();
    refreshQ4Labels();
    lockScroll();
}

function closeListPage() {
    const overlay = document.getElementById('list-page-overlay');
    if (overlay) {
        overlay.remove();
        unlockScroll();
    }
}

// 更新 Q2 信息提示区（清单名称或其他提示）
function updateListHint(text) {
    const el = document.getElementById('list-q2');
    if (el) el.textContent = text;
}

// 渲染 Q3 零件清单区（零件卡片：左图/中信息/右仓库汇总）
async function renderListParts() {
    const q3 = document.getElementById('list-q3');
    if (!q3) return;

    if (!listParts.length) {
        q3.innerHTML = '<div class="list-empty">暂无零件</div>';
        return;
    }

    q3.innerHTML = listParts.map((p) => {
        const partNum = p.part_num != null ? p.part_num : '';
        const colorId = p.colorId != null ? p.colorId : '';
        return `
        <div class="list-part-card" data-part-num="${escapeHtml(partNum)}" data-color-id="${escapeHtml(colorId)}">
            <div class="lpc-left">
                <div class="lpc-img"><div class="no-image">加载中...</div></div>
            </div>
            <div class="lpc-mid">
                <div class="lpc-num">${escapeHtml(partNum)}</div>
                <div class="lpc-name"></div>
                <div class="lpc-row3">
                    <div class="lpc-color">
                        <div class="lpc-color-id">${escapeHtml(colorId)}</div>
                        <div class="lpc-color-name"></div>
                    </div>
                    <div class="lpc-qty-wrap">
                        <div class="lpc-qty-label">数量：</div>
                        <div class="lpc-qty">${escapeHtml(p.quantity != null ? p.quantity : '')}</div>
                    </div>
                </div>
            </div>
            <div class="lpc-right">
                <div class="lpc-repo-label"></div>
                <div class="lpc-repo-total"></div>
            </div>
        </div>`;
    }).join('');

    // 数量文本较多时自动缩小字体，避免超出边界
    q3.querySelectorAll('.lpc-qty').forEach(fitListQtyText);

    // 异步补全各卡片：零件名称/颜色名称/图片/仓库数量汇总
    listParts.forEach((p, i) => {
        const card = q3.children[i];
        if (card) enrichListPartCard(card, p);
    });
}

// HTML 转义（清单卡片文本安全显示）
function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 数量文本超出 46px 宽度时自动缩小字体（16px 起，最小 8px）
function fitListQtyText(el) {
    if (!el) return;
    let size = 16;
    el.style.fontSize = size + 'px';
    while (el.scrollWidth > el.clientWidth + 1 && size > 8) {
        size--;
        el.style.fontSize = size + 'px';
    }
}

// 异步补全单个清单零件卡片：零件名称、颜色名称、图片、仓库数量汇总
async function enrichListPartCard(card, part) {
    const partNum = part.part_num;
    const colorId = part.colorId;

    // ① 零件名称（RB 数据库）
    if (typeof getPartByNum === 'function') {
        getPartByNum(partNum).then((rbPart) => {
            const nameEl = card.querySelector('.lpc-name');
            if (rbPart && rbPart.name && nameEl) nameEl.textContent = rbPart.name;
        }).catch(() => {});
    }

    // ② 颜色名称（RB 数据库）
    if (colorId != null && colorId !== '' && typeof getColorById === 'function') {
        getColorById(colorId).then((color) => {
            const cnEl = card.querySelector('.lpc-color-name');
            if (color && color.name && cnEl) cnEl.textContent = color.name;
        }).catch(() => {});
    }

    // ③ 零件图片（复用全局 getPartImageUrl 三级读取；onload 时自动写入离线缓存）
    if (typeof getPartImageUrl === 'function') {
        getPartImageUrl(partNum, colorId || 0).then((url) => {
            const imgWrap = card.querySelector('.lpc-img');
            if (!imgWrap) return;
            if (url) {
                const escUrl = url.replace(/"/g, '&quot;');
                const partNumEsc = String(partNum).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                const colorIdNum = colorId || 0;
                imgWrap.innerHTML = `<img src="${escUrl}" alt="" onload="autoCachePartImage('${partNumEsc}', ${colorIdNum}, this)" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=no-image>暂无图片</div>'">`;
            } else {
                imgWrap.innerHTML = '<div class="no-image">暂无图片</div>';
            }
        }).catch(() => {
            const imgWrap = card.querySelector('.lpc-img');
            if (imgWrap) imgWrap.innerHTML = '<div class="no-image">暂无图片</div>';
        });
    }

    // ④ 该零件在系统各仓库的数量总数（点击可查看各仓库详情）
    try {
        const summary = await getListPartRepoSummary(partNum);
        const labelEl = card.querySelector('.lpc-repo-label');
        const totalEl = card.querySelector('.lpc-repo-total');
        if (labelEl) labelEl.textContent = summary.repoCount ? `${summary.repoCount}个仓库共：` : '';
        if (totalEl) {
            totalEl.textContent = summary.total;
            if (summary.repoCount) {
                totalEl.title = '点击查看各仓库数量';
                totalEl.addEventListener('click', () => showListPartRepoDetail(partNum));
            } else {
                totalEl.title = '系统暂无该零件库存';
            }
        }
    } catch (e) {
        console.error('获取清单零件仓库汇总失败:', e);
    }
}

// 搜索该零件在系统各仓库的数量汇总（按 part_num 精确匹配，跨仓库）
async function getListPartRepoSummary(partNum) {
    try {
        const [repos, boxes, parts] = await Promise.all([
            getRepositories(),
            supabaseRequest('boxes', { select: 'id,repository_id' }),
            supabaseRequest('parts', { select: 'id,part_num,quantity,box_id' })
        ]);
        const boxRepoMap = {};
        (boxes || []).forEach((b) => { boxRepoMap[b.id] = b.repository_id; });
        const repoNameMap = {};
        (repos || []).forEach((r) => { repoNameMap[r.id] = r.name; });
        const perRepo = {};
        (parts || []).forEach((p) => {
            if (p.part_num !== partNum) return;
            const rid = boxRepoMap[p.box_id];
            if (rid == null) return;
            perRepo[rid] = (perRepo[rid] || 0) + (p.quantity || 0);
        });
        const entries = Object.keys(perRepo).map((id) => ({
            id: Number(id),
            name: repoNameMap[id] || ('仓库' + id),
            quantity: perRepo[id]
        }));
        const total = entries.reduce((s, e) => s + e.quantity, 0);
        return { repos: entries, total: total, repoCount: entries.length };
    } catch (error) {
        console.error('获取清单零件仓库汇总失败:', error.message);
        return { repos: [], total: 0, repoCount: 0 };
    }
}

// 弹窗显示该零件在各个仓库的数量详情
async function showListPartRepoDetail(partNum) {
    const summary = await getListPartRepoSummary(partNum);
    const rows = summary.repos.length
        ? summary.repos.map((r) => `
            <div class="repo-detail-row">
                <span class="repo-detail-name">${escapeHtml(r.name)}</span>
                <span class="repo-detail-qty">${escapeHtml(r.quantity)}</span>
            </div>`).join('')
        : '<div class="repo-detail-empty">系统暂无该零件库存</div>';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const sheet = document.createElement('div');
    sheet.className = 'modal-content repo-detail-modal';
    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">${escapeHtml(partNum)} 仓库分布</span>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="repo-detail-list">${rows}</div>
        </div>
    `;
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
}

// 将各种来源的零件对象规范化为清单卡片所需结构
function normalizeListPart(p) {
    return {
        part_num: p.part_num,
        colorId: (p.colorId != null ? p.colorId : (p.color_id != null ? p.color_id : '')),
        quantity: (p.quantity != null ? p.quantity : 1)
    };
}

// 向清单中追加一个零件并刷新列表
function addListPart(part) {
    if (part && part.part_num) {
        listParts.push(normalizeListPart(part));
        renderListParts();
    }
}

// 清空清单
function clearListParts() {
    listParts = [];
    renderListParts();
}

// 识别：复用搜索页“识别”的拍照识别能力，将识别到的型号返回给型号标签
function identifyModel() {
    recognizePartPhoto((result) => {
        listModel = result.id;
        refreshQ4Labels();
        showToast('已识别型号：' + result.id);
    });
}

// 选色：复用搜索页“选色”的颜色选择弹窗，将选择的颜色ID返回给颜色标签
function pickColor() {
    showColorPickerModal(listModel, (colorId) => {
        listColor = colorId;
        refreshQ4Labels();
    });
}

// “+”：按当前型号/颜色/数量将零件添加到清单（已存在则数量累加）
function addListPartFromSelector() {
    if (!listModel) { showToast('请先输入型号ID'); return; }
    if (!listColor) { showToast('请先选择颜色'); return; }

    const idx = listParts.findIndex((p) => (p.part_num || '') === listModel && (p.colorId || '') === listColor);
    if (idx >= 0) {
        listParts[idx].quantity = (listParts[idx].quantity || 0) + listQty;
    } else {
        listParts.push(normalizeListPart({ part_num: listModel, colorId: listColor, quantity: listQty }));
    }

    renderListParts();
    showToast('已添加到清单');
}

// 刷新 Q4 三个标签的显示值
function refreshQ4Labels() {
    const mv = document.getElementById('q4-model-val');
    const cv = document.getElementById('q4-color-val');
    const qv = document.getElementById('q4-qty-val');
    if (mv) mv.textContent = listModel || '—';
    if (cv) cv.textContent = listColor || '—';
    if (qv) qv.textContent = String(listQty);
}

// 点击 Q4 标签，弹窗输入对应值（避免页面内输入框触发输入法导致画面跳动）
function editQ4Value(field) {
    let title, value, inputType, im;
    if (field === 'model') { title = '请输入型号'; value = listModel; inputType = 'text'; im = 'numeric'; }
    else if (field === 'color') { title = '请输入颜色'; value = listColor; inputType = 'text'; im = 'numeric'; }
    else { title = '请输入数量'; value = String(listQty); inputType = 'number'; im = ''; }

    // 型号输入时才显示内嵌英文词库（三行自动换行、垂直滚动），点选词填入输入框
    const idAbcSection = field === 'model'
        ? `<div class="id-abc-inline-label">型号英文词库</div>
           <div class="id-abc-wrap" id="q4-popup-idabc-wrap"></div>`
        : '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active q4-popup-overlay';
    overlay.dataset.field = field;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { unlockScroll(); overlay.remove(); }
    });
    overlay.innerHTML = `
        <div class="q4-popup">
            <div class="q4-popup-title">${title}</div>
            <input class="q4-popup-input" id="q4-popup-input" type="${inputType}" inputmode="${im}" min="${inputType === 'number' ? 1 : ''}" value="${value}">
            <div class="q4-popup-actions">
                <button class="q4-popup-btn" onclick="cancelQ4Input(this)">取消</button>
                <button class="q4-popup-btn q4-popup-btn-confirm" onclick="confirmQ4Input(this)">确定</button>
            </div>
            ${idAbcSection}
        </div>
    `;
    document.body.appendChild(overlay);
    lockScroll();

    const input = overlay.querySelector('#q4-popup-input');
    input.focus();
    if (input.select) input.select();

    // 型号输入：加载内嵌英文词库
    if (field === 'model') {
        initQ4IDAbcLibrary(overlay);
    }

    // 键盘回车/打勾键：顺带触发弹窗“确定”按钮
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const confirmBtn = overlay.querySelector('.q4-popup-btn-confirm');
            confirmQ4Input(confirmBtn);
        }
    });
}

function cancelQ4Input(btn) {
    const ov = btn.closest('.modal-overlay');
    if (ov) { ov.remove(); unlockScroll(); }
}

function confirmQ4Input(btn) {
    const ov = btn.closest('.modal-overlay');
    if (!ov) return;
    const field = ov.dataset.field;
    const val = ov.querySelector('#q4-popup-input').value.trim();
    if (field === 'quantity') {
        const n = parseInt(val, 10);
        listQty = (!n || n < 1) ? 1 : n;
    } else if (field === 'model') {
        listModel = val;
    } else {
        listColor = val;
    }
    ov.remove();
    unlockScroll();
    refreshQ4Labels();
}

// 全局暴露，供内联 onclick 调用
window.openListPage = openListPage;
window.closeListPage = closeListPage;
window.updateListHint = updateListHint;
window.addListPart = addListPart;
window.clearListParts = clearListParts;
window.renderListParts = renderListParts;
window.identifyModel = identifyModel;
window.pickColor = pickColor;
window.addListPartFromSelector = addListPartFromSelector;
window.refreshQ4Labels = refreshQ4Labels;
window.editQ4Value = editQ4Value;
window.confirmQ4Input = confirmQ4Input;
window.cancelQ4Input = cancelQ4Input;