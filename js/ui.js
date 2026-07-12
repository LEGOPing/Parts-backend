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

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    document.querySelectorAll('.nav button').forEach(button => {
        button.classList.remove('active');
    });
    event.target.classList.add('active');
    
    if (tabName === 'repositories') {
        loadRepositories();
    } else if (tabName === 'parts') {
        if (selectedBox) {
            loadParts(selectedBox.id);
        }
    } else if (tabName === 'search') {
        clearSearchResults();
    }
}

async function loadRepositories() {
    const repos = await getRepositories();
    const list = document.getElementById('repositories-list');
    list.innerHTML = '';
    
    document.getElementById('repository-count').textContent = repos.length;
    
    repos.forEach(repo => {
        const card = document.createElement('div');
        card.className = `repository-card ${selectedRepository && selectedRepository.id === repo.id ? 'selected' : ''}`;
        card.dataset.id = repo.id;
        
        card.innerHTML = `
            <h3>${repo.name}</h3>
            <div class="repo-info">
                <span class="repo-id">ID: ${repo.id}</span>
                <span class="repo-box-count">0B</span>
            </div>
        `;
        
        getBoxes(repo.id).then(boxes => {
            card.querySelector('.repo-box-count').textContent = `${boxes.length}B`;
        });
        
        card.addEventListener('click', () => {
            if (!editingRepository) {
                selectRepository(repo);
            }
        });
        
        let longPressTimer;
        card.addEventListener('mousedown', () => {
            longPressTimer = setTimeout(() => {
                if (repo.name !== '待定盒子') {
                    startEditRepository(card, repo);
                }
            }, 1000);
        });
        
        card.addEventListener('mouseup', () => clearTimeout(longPressTimer));
        card.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
        
        list.appendChild(card);
    });
}

async function selectRepository(repo) {
    setSelectedRepository(repo);
    
    document.querySelectorAll('.repository-card').forEach(card => {
        card.classList.remove('selected');
        if (card.dataset.id === repo.id) {
            card.classList.add('selected');
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
        <div class="repo-info">
            <span class="repo-id">ID: ${repo.id}</span>
            <span class="repo-box-count">0B</span>
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
    const newRepo = await createRepository('新仓库');
    if (newRepo) {
        await loadRepositories();
        setTimeout(() => {
            selectRepository(newRepo);
        }, 100);
    }
}

async function deleteRepositoryConfirm(id) {
    if (confirm('确定要删除这个仓库吗？删除后将同时删除仓库中的所有盒子和零件。')) {
        const success = await deleteRepository(id);
        if (success) {
            if (selectedRepository && selectedRepository.id === id) {
                setSelectedRepository(null);
                document.getElementById('box-management').style.display = 'none';
                document.getElementById('no-repository-selected').style.display = 'flex';
            }
            await loadRepositories();
        }
    }
}

async function loadBoxes(repoId) {
    const boxes = await getBoxes(repoId);
    const grid = document.getElementById('boxes-list');
    grid.innerHTML = '';
    
    document.getElementById('box-count').textContent = boxes.length;
    
    boxes.forEach(box => {
        const card = document.createElement('div');
        card.className = `box-card ${box.name === '新盒子' ? 'default' : ''}`;
        card.dataset.id = box.id;
        
        card.innerHTML = `
            <h4>${box.name}</h4>
            <div class="box-info">
                <div class="box-number">ID: ${box.box_number}</div>
                <div class="box-part-count">0P</div>
            </div>
        `;
        
        getParts(box.id).then(parts => {
            card.querySelector('.box-part-count').textContent = `${parts.length}P`;
        });
        
        card.addEventListener('click', () => {
            if (!editingBox) {
                setSelectedBox(box);
                document.getElementById('selected-box-name').textContent = `${box.name}盒子_零件管理`;
                switchTab('parts');
            }
        });
        
        let longPressTimer;
        card.addEventListener('mousedown', () => {
            longPressTimer = setTimeout(() => {
                if (box.name !== '待定零件') {
                    startEditBox(card, box);
                }
            }, 1000);
        });
        
        card.addEventListener('mouseup', () => clearTimeout(longPressTimer));
        card.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
        
        grid.appendChild(card);
    });
}

function startEditBox(card, box) {
    setEditingBox(box);
    
    card.innerHTML = `
        <input type="text" value="${box.name}" class="box-edit-input" />
        <div class="box-info">
            <div class="box-number">ID: ${box.box_number}</div>
            <div class="box-part-count">0P</div>
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
    }
}

async function deleteBoxConfirm(id) {
    if (confirm('确定要删除这个盒子吗？')) {
        const success = await deleteBox(id);
        if (success && selectedRepository) {
            await loadBoxes(selectedRepository.id);
        }
    }
}

async function loadParts(boxId) {
    const parts = await getParts(boxId);
    const list = document.getElementById('parts-list');
    list.innerHTML = '';
    
    document.getElementById('part-count').textContent = parts.length;
    
    parts.forEach(part => {
        const card = document.createElement('div');
        card.className = 'part-card';
        card.dataset.id = part.id;
        
        getColorName(part.color_id).then(colorName => {
            card.innerHTML = `
                <div class="part-num">${part.part_num}</div>
                <div class="part-image">
                    <img src="https://rebrickable.com/media/${part.part_num}.png" alt="${part.name}" onerror="this.style.display='none'">
                </div>
                <div class="part-name">${part.name}</div>
                <div class="part-color">${colorName || '未知颜色'}</div>
                <div class="part-info">
                    <span class="part-new-status ${part.is_new ? 'new' : 'used'}">${part.is_new ? '新' : '旧'}</span>
                    <span class="part-quantity">${part.quantity}</span>
                </div>
            `;
        });
        
        card.addEventListener('click', () => {
            console.log('点击零件:', part.name);
        });
        
        let longPressTimer;
        card.addEventListener('mousedown', () => {
            longPressTimer = setTimeout(() => {
                editPartQuantity(part);
            }, 800);
        });
        
        card.addEventListener('mouseup', () => clearTimeout(longPressTimer));
        card.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
        
        list.appendChild(card);
    });
}

function editPartQuantity(part) {
    const newQuantity = prompt(`请输入新数量 (当前: ${part.quantity}):`, part.quantity);
    if (newQuantity !== null) {
        const quantity = parseInt(newQuantity);
        if (!isNaN(quantity) && quantity >= 0) {
            updatePartQuantity(part.id, quantity);
        } else {
            alert('请输入有效的数量');
        }
    }
}

async function updatePartQuantity(partId, quantity) {
    const success = await updatePart(partId, { quantity: quantity });
    if (success && selectedBox) {
        await loadParts(selectedBox.id);
    }
}

function showAddPartSheet() {
    if (!selectedBox) {
        alert('请先选择一个盒子');
        return;
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    
    const sheet = document.createElement('div');
    sheet.className = 'modal-content';
    
    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">添加零件</span>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">取消</button>
                <button class="btn-save" onclick="saveNewPart(this)">保存</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="form-section">
                <div class="form-row">
                    <label class="form-label">零件型号：</label>
                    <input type="text" id="new-part-num" class="form-input" placeholder="请输入零件型号" />
                    <button class="btn-secondary" onclick="showPartSelector()" style="padding: 8px 10px; font-size: 12px;">选择零件</button>
                    <div class="status-group">
                        <span class="status-label">状态：</span>
                        <button id="status-new" class="status-btn active" onclick="togglePartNewStatus(true)">新品</button>
                        <button id="status-used" class="status-btn" onclick="togglePartNewStatus(false)">旧品</button>
                    </div>
                </div>
            </div>
            <div class="form-section">
                <div class="form-row">
                    <label class="form-label">零件名称：</label>
                    <input type="text" id="new-part-name" class="form-input" placeholder="请输入零件名称" />
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
                        <input type="number" id="new-part-quantity" class="form-input" placeholder="请输入数量" value="1" />
                    </div>
                </div>
            </div>
            <div id="add-part-error" style="color: red; font-size: 12px; display: none; padding: 10px; background: rgba(255, 0, 0, 0.1); border-radius: 4px;"></div>
        </div>
    `;
    
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    
    window.newPartIsNew = true;
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

function showPartSelector() {
    alert('零件选择器功能开发中...');
}

function showColorPicker() {
    const colors = [
        { id: 1, name: '黑色' }, { id: 4, name: '白色' },
        { id: 5, name: '红色' }, { id: 7, name: '黄色' },
        { id: 9, name: '绿色' }, { id: 11, name: '蓝色' },
        { id: 12, name: '亮蓝色' }, { id: 13, name: '紫色' },
        { id: 15, name: '粉色' }
    ];
    
    let colorOptions = colors.map(c => `${c.id}: ${c.name}`).join('\n');
    const selected = prompt(`选择颜色:\n${colorOptions}\n\n输入颜色ID:`);
    if (selected && !isNaN(parseInt(selected))) {
        document.getElementById('new-part-color').value = selected;
    }
}

async function handleSearch() {
    const query = document.getElementById('search-input').value;
    if (!query) {
        alert('请输入搜索关键词');
        return;
    }
    
    const parts = await searchParts(query);
    const results = document.getElementById('search-results');
    results.innerHTML = '';
    
    if (parts.length === 0) {
        results.innerHTML = '<p>没有找到匹配的零件</p>';
        return;
    }
    
    parts.forEach(part => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <span>${part.part_num} - ${part.name} (数量: ${part.quantity})</span>
        `;
        results.appendChild(item);
    });
}

function clearSearchResults() {
    document.getElementById('search-input').value = '';
    document.getElementById('search-results').innerHTML = '';
}

function goBackToRepositories() {
    setSelectedBox(null);
    switchTab('repositories');
}

function initializeApp() {
    const P = calculateP();
    document.documentElement.style.setProperty('--P', P);
    document.documentElement.style.setProperty('--card-width', (3 * P) + 'px');
    document.documentElement.style.setProperty('--card-height', (2 * P) + 'px');
    document.documentElement.style.setProperty('--grid-width', (9 * P + 30) + 'px');
    
    loadRepositories();
}