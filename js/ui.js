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
    const PASSWORD = '22332468';
    
    // 第一次密码验证
    const pwd1 = prompt('请输入删除密码：');
    if (pwd1 !== PASSWORD) {
        alert('密码错误，操作已取消');
        return;
    }
    
    // 第二次密码验证
    const pwd2 = prompt('请再次输入密码确认：');
    if (pwd2 !== PASSWORD) {
        alert('密码错误，操作已取消');
        return;
    }
    
    // 查找要删除的仓库
    const repos = await getRepositories();
    const repoToDelete = repos.find(r => r.id === parseInt(id));
    if (!repoToDelete) {
        alert('仓库不存在');
        return;
    }
    
    // 查找或创建临时仓库
    let tempRepo = repos.find(r => r.name === '临时仓库');
    if (!tempRepo) {
        tempRepo = await createRepository('临时仓库');
        if (!tempRepo) {
            alert('创建临时仓库失败');
            return;
        }
    }
    
    // 显示删除确认提示
    if (!confirm(`删除后，原仓库「${repoToDelete.name}」的盒子将转入「临时仓库」，确认删除吗？`)) {
        return;
    }
    
    // 将盒子转移到临时仓库
    const boxes = await getBoxes(parseInt(id));
    for (const box of boxes) {
        await updateBox(box.id, { repository_id: tempRepo.id });
    }
    
    // 删除仓库
    const success = await deleteRepository(id);
    if (success) {
        if (selectedRepository && selectedRepository.id === parseInt(id)) {
            setSelectedRepository(tempRepo);
            await loadBoxes(tempRepo.id);
            document.getElementById('box-management').style.display = 'block';
            document.getElementById('no-repository-selected').style.display = 'none';
            document.getElementById('selected-repository-name').textContent = `${tempRepo.name} - 盒子管理`;
        }
        await loadRepositories();
    }
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
        const card = document.createElement('div');
        card.className = `box-card ${box.name === '新盒子' ? 'default' : ''}`;
        card.dataset.id = box.id;
        
        const isTempBox = box.name === '临时盒子';
        const deleteBtn = isTempBox ? '' : `<button class="box-delete-btn" onclick="event.stopPropagation(); deleteBoxConfirm('${box.id}')">×</button>`;
        
        card.innerHTML = `
                ${deleteBtn}
                <div class="box-card-name">${box.name}</div>
                <div class="box-card-footer">
                    <span class="box-id">ID: ${box.box_number}</span>
                    <span class="box-part-count"><span class="count">${partCounts[box.id]}</span> <span class="unit">P</span></span>
                </div>
            `;
        
        card.addEventListener('click', () => {
            if (!editingBox) {
                setSelectedBox(box);
                document.getElementById('selected-box-name').textContent = `${box.name}零件管理`;
                
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
        
        setupLongPress(card, () => {
            if (box.name !== '临时盒子') {
                startEditBox(card, box);
            }
        });
        
        grid.appendChild(card);
    });
}

function startEditBox(card, box) {
    setEditingBox(box);
    
    card.innerHTML = `
        <input type="text" value="${box.name}" class="box-edit-input" />
        <div class="box-card-footer">
            <span class="box-id">ID: ${box.box_number}</span>
            <span class="box-part-count"><span class="count">0</span> <span class="unit">P</span></span>
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
    
    if (confirm('确定要删除这个盒子吗？')) {
        const success = await deleteBox(id);
        if (success && selectedRepository) {
            await loadBoxes(selectedRepository.id);
            await loadRepositories();
        }
    }
}

async function loadParts(boxId) {
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
                <span class="part-quantity">${part.quantity}</span>
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
        
        setupLongPress(card, () => editPartQuantity(part));
        
        list.appendChild(card);
    });
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

function editPartQuantity(part) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active quantity-edit-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'quantity-edit-modal';

    let qtyCls = 'qty-red';
    if (part.quantity >= 50) qtyCls = 'qty-green';
    else if (part.quantity >= 10) qtyCls = 'qty-orange';

    sheet.innerHTML = `
        <div class="qe-row qe-row1">
            <button class="qe-back-btn" onclick="this.closest('.modal-overlay').remove()">返回</button>
            <span class="qe-title">编辑数量</span>
            <button class="qe-save-btn" onclick="savePartQuantity('${part.id}', this)">保存</button>
        </div>
        <div class="qe-row qe-row2">
            <div class="qe-quantity ${qtyCls}" id="quantity-display">${part.quantity}</div>
        </div>
        <div class="qe-row qe-row3">
            <button class="qe-circle-btn qe-minus-btn" onclick="changeQuantity(-1)">−</button>
            <button class="qe-circle-btn qe-plus-btn" onclick="changeQuantity(1)">+</button>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    window.currentEditQuantity = part.quantity;

    function changeQuantity(delta) {
        window.currentEditQuantity = Math.max(0, window.currentEditQuantity + delta);
        const display = document.getElementById('quantity-display');
        display.textContent = window.currentEditQuantity;
        display.classList.remove('qty-red', 'qty-orange', 'qty-green');
        let cls = 'qty-red';
        if (window.currentEditQuantity >= 50) cls = 'qty-green';
        else if (window.currentEditQuantity >= 10) cls = 'qty-orange';
        display.classList.add(cls);
    }

    window.changeQuantity = changeQuantity;
}

async function savePartQuantity(partId, btn) {
    const quantity = window.currentEditQuantity;
    if (quantity < 0) return;

    const success = await updatePartQuantity(partId, quantity);
    if (success) {
        // 仅移除编辑数量弹窗，保留底下的零件详情页
        btn.closest('.modal-overlay').remove();
        // 更新零件详情页显示的数量
        updateDetailQuantityDisplay(quantity);
        // 更新搜索结果卡片中对应零件的数量
        updateSearchResultQuantity(partId, quantity);
    } else {
        alert('保存失败');
    }
}

async function updatePartQuantity(partId, quantity) {
    const success = await updatePart(partId, { quantity: quantity });
    if (success && selectedBox) {
        await loadParts(selectedBox.id);
    }
    return success;
}

// 更新零件详情页中显示的数量与颜色
function updateDetailQuantityDisplay(quantity) {
    const detailModal = document.querySelector('.part-detail-modal');
    if (!detailModal) return;
    const qtyEl = detailModal.querySelector('.pd-qty-val');
    if (!qtyEl) return;
    qtyEl.textContent = quantity;
    qtyEl.classList.remove('qty-red', 'qty-orange', 'qty-green');
    let cls = 'qty-red';
    if (quantity >= 50) cls = 'qty-green';
    else if (quantity >= 10) cls = 'qty-orange';
    qtyEl.classList.add(cls);
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
            <span class="modal-title">添加零件</span>
            <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">取消</button>
        </div>
        <div class="modal-body add-part-body">
            <div class="form-section">
                <div class="form-row part-number-row">
                    <label class="form-label">零件型号：</label>
                    <div class="part-number-input-wrapper">
                        <input type="text" id="new-part-num" class="form-input" placeholder="请输入零件型号" autocomplete="off" />
                        <div class="part-number-suggestions" id="part-number-suggestions"></div>
                    </div>
                    <span class="part-name-hint" id="part-name-hint"></span>
                    <button class="btn-secondary" onclick="showPartSelector()" style="padding: 8px 10px; font-size: 12px;">选择零件</button>
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
                    <input type="text" id="new-part-color" class="form-input" placeholder="请输入颜色ID" />
                    <button class="btn-secondary" onclick="showColorPicker()" style="padding: 8px 10px; font-size: 12px;">选择颜色</button>
                </div>
            </div>
            <div class="form-section">
                <div class="quantity-weight-row">
                    <div>
                        <label class="form-label">零件数量：</label>
                        <div class="quantity-input-row">
                            <input type="number" id="new-part-quantity" class="form-input" placeholder="请输入数量" value="1" />
                            <button class="btn-weight-calc" onclick="showWeightCalculator()">称重计算</button>
                        </div>
                    </div>
                </div>
                <div class="form-row status-save-row">
                    <div class="status-group">
                        <span class="status-label">状态：</span>
                        <button id="status-new" class="status-btn active" onclick="togglePartNewStatus(true)">新品</button>
                        <button id="status-used" class="status-btn" onclick="togglePartNewStatus(false)">旧品</button>
                    </div>
                    <button class="btn-save" onclick="saveNewPart(this)">保存</button>
                </div>
            </div>
            <div class="part-info-preview" id="part-info-preview" style="display: none;"></div>
            <div id="add-part-error" style="color: red; font-size: 12px; display: none; padding: 10px; background: rgba(255, 0, 0, 0.1); border-radius: 4px;"></div>
        </div>
    `;
    
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
        
        // 延迟1秒触发查询
        partNumTimer = setTimeout(async () => {
            await showPartNumSuggestions(value);
            
            // 如果是精确匹配，自动填充信息
            const part = await getPartByNum(value);
            if (part) {
                partNameInput.value = part.name || '';
                updatePartInfoPreview();
            }
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
    
    const newPart = await createPart({
        box_id: selectedBox.id,
        part_num: partNum,
        name: partName || partNum,
        color_id: parseInt(colorInput),
        quantity: quantity,
        is_new: window.newPartIsNew
    });
    
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
            document.getElementById('new-part-color').value = color.id;
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

function resetSearchFilters() {
    document.getElementById('search-part-num').value = '';
    document.getElementById('search-part-name').value = '';
    document.getElementById('search-color-id').value = '';
    document.getElementById('search-status').value = '';
    document.getElementById('search-results').innerHTML = '';
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
                </div>
                <div class="src-row src-row3">
                    <span class="src-label">仓库：</span><span class="src-repo">${repoName}</span>
                    <span class="src-status ${part.is_new ? 'new' : 'used'}" title="${part.is_new ? '新品' : '旧品'}"></span>
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
        // 检查是否有自定义图片
        hasCustomImage = !!getCustomImageUrl(part.part_num, part.color_id);
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

    // 图片操作按钮
    let imageActionsHtml = '';
    if (!imgUrl) {
        imageActionsHtml = `<button class="pd-btn pd-btn-search" style="background:#4CAF50;margin-top:4px;" onclick="addCustomImage('${part.part_num}', ${part.color_id})">添加图片</button>`;
    } else if (hasCustomImage) {
        imageActionsHtml = `<button class="pd-btn pd-btn-edit" style="margin-top:4px;" onclick="manageCustomImage('${part.part_num}', ${part.color_id})">管理图片</button>`;
    }

    sheet.innerHTML = `
        <div class="pd-row pd-title">零件详情</div>
        <div class="pd-row pd-image-row">
            ${imageHtml}
        </div>
        <div class="pd-row" style="justify-content:center;flex-shrink:0;">
            ${imageActionsHtml}
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
                <span class="pd-qty-val ${qtyColorClass}">${qty}</span>
            </div>
        </div>
        <div class="pd-row pd-actions">
            <button class="pd-btn pd-btn-close" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            <button class="pd-btn pd-btn-search" onclick="searchFromDetail('${part.part_num}', ${part.color_id}, '${safePartName}')">搜索</button>
            <div class="pd-btn-group">
                <button class="pd-btn pd-btn-delete" onclick="deletePartConfirm('${part.id}')">删除零件</button>
                <button class="pd-btn pd-btn-edit" onclick="editPartQuantityFromDetail('${part.id}', ${part.quantity})">编辑数量</button>
            </div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
}

function editPartQuantityFromDetail(partId, currentQuantity) {
    // 不关闭零件详情页，让编辑数量弹窗浮于其上
    const part = { id: partId, quantity: currentQuantity };
    editPartQuantity(part);
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

// 从URL保存图片
function saveImageFromUrl(partNum, colorId) {
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
    
    const success = saveCustomImageUrl(partNum, colorId, url);
    const statusEl = document.getElementById('custom-img-status');
    
    if (success) {
        statusEl.textContent = '✓ 图片添加成功！';
        statusEl.style.color = '#4CAF50';
        setTimeout(() => {
            // 关闭所有弹窗并重新显示详情
            const overlays = document.querySelectorAll('.modal-overlay.active');
            overlays.forEach(o => o.remove());
            // 重新获取零件信息并显示详情
            refreshPartDetailWithCustomImage(partNum, colorId);
        }, 1000);
    } else {
        statusEl.textContent = '✗ 保存失败';
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
    reader.onload = function(e) {
        const imageDataUrl = e.target.result;
        const success = saveCustomImageUrl(partNum, colorId, imageDataUrl);
        const preview = document.getElementById('custom-img-preview');
        const previewImg = document.getElementById('custom-img-preview-img');
        const statusEl = document.getElementById('custom-img-status');
        
        preview.style.display = 'block';
        previewImg.src = imageDataUrl;
        
        if (success) {
            statusEl.textContent = '✓ 图片上传成功！';
            statusEl.style.color = '#4CAF50';
            setTimeout(() => {
                const overlays = document.querySelectorAll('.modal-overlay.active');
                overlays.forEach(o => o.remove());
                refreshPartDetailWithCustomImage(partNum, colorId);
            }, 1000);
        } else {
            statusEl.textContent = '✗ 保存失败（可能是存储空间不足）';
            statusEl.style.color = '#f44336';
        }
    };
    reader.readAsDataURL(file);
}

// 管理自定义图片
function manageCustomImage(partNum, colorId) {
    const currentUrl = getCustomImageUrl(partNum, colorId);
    
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

// 删除自定义图片
function removeCustomImage(partNum, colorId) {
    if (!confirm('确定要删除自定义图片吗？')) return;
    
    deleteCustomImageUrl(partNum, colorId);
    
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
    // 关闭可能存在的旧密码弹窗
    const oldPw = document.querySelector('.pd-password-overlay');
    if (oldPw) oldPw.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active pd-password-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content pd-password-modal';

    sheet.innerHTML = `
        <div class="pd-row pd-title">删除确认</div>
        <div class="pd-password-body">
            <p class="pd-password-hint">请输入密码以确认删除零件</p>
            <input type="password" id="pd-delete-password" class="pd-password-input" placeholder="请输入密码" autocomplete="off" />
            <div class="pd-password-error" id="pd-password-error"></div>
        </div>
        <div class="pd-row pd-actions">
            <button class="pd-btn pd-btn-close" onclick="this.closest('.modal-overlay').remove()">取消</button>
            <div class="pd-btn-group">
                <button class="pd-btn pd-btn-delete" onclick="executeDeletePart('${partId}')">确认删除</button>
            </div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const input = document.getElementById('pd-delete-password');
    if (input) {
        input.focus();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                executeDeletePart(partId);
            }
        });
    }
}

async function executeDeletePart(partId) {
    const input = document.getElementById('pd-delete-password');
    const errorEl = document.getElementById('pd-password-error');
    if (!input) return;

    const password = input.value;
    if (password !== '22332468') {
        if (errorEl) errorEl.textContent = '密码错误，请重新输入';
        input.value = '';
        input.focus();
        return;
    }

    // 确保 partId 为数字
    const numericPartId = parseInt(partId);

    const success = await deletePart(numericPartId);
    if (success) {
        // 关闭密码弹窗
        const pwOverlay = document.querySelector('.pd-password-overlay');
        if (pwOverlay) pwOverlay.remove();
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
        if (errorEl) errorEl.textContent = '删除零件失败';
    }
}

async function goBackToRepositories() {
    setSelectedBox(null);
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
        <div class="modal-header">
            <span class="modal-title">批量导入零件</span>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="csv-importer-container">
                <div class="csv-upload-area" id="csv-upload-area">
                    <input type="file" id="csv-file-input" accept=".csv" style="display: none;">
                    <div class="csv-upload-icon">📁</div>
                    <div class="csv-upload-text">点击或拖拽CSV文件到此处</div>
                    <div class="csv-format-hint">支持格式: part_num,name,color_id,quantity,is_new</div>
                </div>
                <div class="csv-preview" id="csv-preview" style="display: none;">
                    <h4>预览数据</h4>
                    <div class="csv-preview-table" id="csv-preview-table"></div>
                    <button class="btn-import-csv" onclick="confirmCSVImport()">确认导入</button>
                </div>
                <div class="import-status" id="import-status" style="display: none;"></div>
            </div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const uploadArea = document.getElementById('csv-upload-area');
    const fileInput = document.getElementById('csv-file-input');

    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', (e) => e.preventDefault());
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.csv')) {
            processCSVFile(file);
        }
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            processCSVFile(file);
        }
    });
}

function parseCSVContent(content) {
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
                item[header.trim().toLowerCase()] = row[index] || '';
            });
            return item;
        });

        showCSVPreview(headers, importData);
    };

    reader.readAsText(file);
}

function showCSVPreview(headers, data) {
    const preview = document.getElementById('csv-preview');
    const uploadArea = document.getElementById('csv-upload-area');
    const table = document.getElementById('csv-preview-table');

    uploadArea.style.display = 'none';
    preview.style.display = 'block';

    let html = '<table><thead><tr>';
    headers.forEach(h => {
        html += `<th>${h}</th>`;
    });
    html += '</tr></thead><tbody>';

    data.forEach(row => {
        html += '<tr>';
        headers.forEach(h => {
            html += `<td>${row[h.trim().toLowerCase()] || ''}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    table.innerHTML = html;

    window.currentCSVData = data;
}

async function confirmCSVImport() {
    if (!selectedBox || !window.currentCSVData) return;

    const data = window.currentCSVData.map(item => ({
        ...item,
        box_id: selectedBox.id
    }));

    const status = document.getElementById('import-status');
    const preview = document.getElementById('csv-preview');
    
    preview.style.display = 'none';
    status.style.display = 'block';
    status.innerHTML = '<div class="import-loading">正在导入...</div>';

    const result = await batchCreateParts(data);

    if (result.success) {
        status.innerHTML = `
            <div class="import-success">
                <div class="success-icon">✓</div>
                <div>导入成功！</div>
                <div>成功导入 ${result.count} 个零件</div>
                <button class="btn-close-import" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        `;
        if (selectedBox) {
            loadParts(selectedBox.id);
        }
    } else {
        let errorHtml = `
            <div class="import-error">
                <div class="error-icon">✗</div>
                <div>导入完成，但有部分失败</div>
                <div>成功导入 ${result.count} 个零件</div>
                <div class="error-list">
        `;
        result.errors.forEach(e => {
            errorHtml += `<div>${e.part_num}: ${e.error}</div>`;
        });
        errorHtml += `
                </div>
                <button class="btn-close-import" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        `;
        status.innerHTML = errorHtml;
        if (selectedBox) {
            loadParts(selectedBox.id);
        }
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
                const csvText = await fetchRBFile(file.name);
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
                const csvText = await fetchRBFile(file.name);
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