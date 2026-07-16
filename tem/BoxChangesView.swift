//
//  BoxChangesView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/14.
//

import SwiftUI
import CoreData

struct BoxChangesView: View {
    @Binding var isPresented: Bool
    let viewContext: NSManagedObjectContext
    
    @State private var selectedBoxes: [NSManagedObject] = []
    @State private var selectedTargetRepository: NSManagedObject?
    @State private var pendingBoxRepository: NSManagedObject?
    @State private var pendingPartsBox: NSManagedObject?
    @State private var showDeleteConfirmation = false
    @State private var isDeleting = false
    @State private var isChangingRepository = false
    
    var body: some View {
        VStack(spacing: 0) {
            // 顶部标题栏，包含标题和关闭按钮
            HStack {
                Text("盒子变动")
                    .font(.system(size: 24, weight: .bold))
                Spacer()
                Button(action: {
                    isPresented = false
                }) {
                    Text("关闭")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.gray)
                        .cornerRadius(6)
                }
            }
            .padding()
            .background(Color.white)
            .shadow(radius: 2)
            
            // 主内容区域
            GeometryReader { geometry in
                VStack(spacing: 16) {
                    // 上部：选择盒子，垂直滚动
                    VStack(alignment: .leading, spacing: 12) {
                        Text("选择盒子")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.primary)
                        
                        ScrollView {
                            // 按仓库分组显示盒子
                            ForEach(getBoxesByRepository(), id: \.repositoryName) { group in
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(group.repositoryName)
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.blue)
                                        .padding(.horizontal, 20)
                                    
                                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 15) {
                                        ForEach(group.boxes, id: \.objectID) { box in
                                            let isSelected = selectedBoxes.contains { $0.objectID == box.objectID }
                                            let isPendingParts = box.value(forKey: "name") as? String == "待定零件"
                                            
                                            ZStack {
                                                // 卡片背景
                                                RoundedRectangle(cornerRadius: 8)
                                                    .fill(isSelected ? Color.blue.opacity(0.2) : Color.white)
                                                    .stroke(isSelected ? Color.blue : Color.gray.opacity(0.3), lineWidth: 2)
                                                    .shadow(radius: 2)
                                                
                                                // 卡片内容
                                                VStack(spacing: 6) {
                                                    Text(box.value(forKey: "name") as? String ?? "未命名盒子")
                                                        .font(.system(size: 12, weight: .bold))
                                                        .multilineTextAlignment(.center)
                                                        .lineLimit(2)
                                                    Text("ID: \(box.value(forKey: "boxNumber") as? Int32 ?? 0)")
                                                        .font(.system(size: 10))
                                                        .foregroundColor(.gray)
                                                }
                                                .padding(8)
                                            }
                                            .frame(height: 80)
                                            .onTapGesture {
                                                if !isPendingParts {
                                                    if isSelected {
                                                        selectedBoxes.removeAll { $0.objectID == box.objectID }
                                                    } else {
                                                        selectedBoxes.append(box)
                                                    }
                                                }
                                            }
                                            .opacity(isPendingParts ? 0.5 : 1.0)
                                            .disabled(isPendingParts)
                                        }
                                    }
                                    .padding(.horizontal, 20)
                                }
                                .padding(.bottom, 16)
                            }
                        }
                    }
                    .frame(maxHeight: geometry.size.height * 0.6) // 占用60%的空间
                    
                    // 中部：选择目标仓库，水平滚动
                    VStack(alignment: .leading, spacing: 12) {
                        Text("选择目标仓库")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.primary)
                        
                        ScrollView(.horizontal, showsIndicators: false) {
                            VStack(spacing: 10) {
                                LazyHGrid(rows: Array(repeating: GridItem(.flexible(), spacing: 15), count: 1), spacing: 15) {
                                    ForEach(getAllRepositories(), id: \.objectID) { repository in
                                        let isSelected = selectedTargetRepository?.objectID == repository.objectID
                                        
                                        ZStack {
                                            // 卡片背景
                                            RoundedRectangle(cornerRadius: 8)
                                                .fill(isSelected ? Color.green.opacity(0.2) : Color.white)
                                                .stroke(isSelected ? Color.green : Color.gray.opacity(0.3), lineWidth: 2)
                                                .shadow(radius: 2)
                                            
                                            // 卡片内容
                                            VStack(spacing: 8) {
                                                Text(repository.value(forKey: "name") as? String ?? "未命名仓库")
                                                    .font(.system(size: 14, weight: .bold))
                                                    .multilineTextAlignment(.center)
                                                    .lineLimit(2)
                                                Text("ID: \(repository.value(forKey: "id") as? Int32 ?? 0)")
                                                    .font(.system(size: 12))
                                                    .foregroundColor(.gray)
                                            }
                                            .padding(10)
                                        }
                                        .frame(width: 120, height: 80)
                                        .onTapGesture {
                                            selectedTargetRepository = repository
                                        }
                                    }
                                }
                                .padding(.horizontal, 20)
                            }
                        }
                        .frame(height: 110)
                    }
                    
                    // 下部：操作按钮
                    HStack(spacing: 16) {
                        Button(action: {
                            if !selectedBoxes.isEmpty && !isDeleting && !isChangingRepository {
                                showDeleteConfirmation.toggle()
                            }
                        }) {
                            if isDeleting {
                                HStack(spacing: 8) {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    Text("删除中...")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                }
                                .padding(.horizontal, 24)
                                .padding(.vertical, 12)
                                .background(Color.red)
                                .cornerRadius(8)
                            } else {
                                Text("删除选中盒子")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 24)
                                    .padding(.vertical, 12)
                                    .background(!selectedBoxes.isEmpty ? Color.red : Color.gray)
                                    .cornerRadius(8)
                            }
                        }
                        .disabled(selectedBoxes.isEmpty || isDeleting || isChangingRepository)
                        
                        Spacer()
                        
                        Button(action: {
                            if !selectedBoxes.isEmpty && selectedTargetRepository != nil && !isDeleting && !isChangingRepository {
                                isChangingRepository = true
                                changeBoxesRepository()
                            }
                        }) {
                            if isChangingRepository {
                                HStack(spacing: 8) {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    Text("改仓中...")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                }
                                .padding(.horizontal, 24)
                                .padding(.vertical, 12)
                                .background(Color.blue)
                                .cornerRadius(8)
                            } else {
                                Text("确认改仓")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 24)
                                    .padding(.vertical, 12)
                                    .background(!selectedBoxes.isEmpty && selectedTargetRepository != nil ? Color.blue : Color.gray)
                                    .cornerRadius(8)
                            }
                        }
                        .disabled(selectedBoxes.isEmpty || selectedTargetRepository == nil || isDeleting || isChangingRepository)
                    }
                    .padding(.horizontal, 20)
                }
                .padding(.vertical, 16)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0xF5/255, green: 0xF5/255, blue: 0xF5/255))
        .alert(isPresented: $showDeleteConfirmation) {
            Alert(
                title: Text("确认删除"),
                message: Text("确定要删除这些盒子吗？删除后盒子中的所有零件将移到'待定零件'盒子。"),
                primaryButton: .destructive(Text("删除")) {
                    deleteSelectedBoxes()
                },
                secondaryButton: .cancel(Text("取消"))
            )
        }
        .onAppear {
            ensurePendingBoxRepositoryExists()
        }
    }
    
    // 盒子分组数据结构
    struct BoxGroup {
        let repositoryName: String
        let boxes: [NSManagedObject]
    }
    
    // 按仓库分组获取盒子
    private func getBoxesByRepository() -> [BoxGroup] {
        let allBoxes = getAllBoxes()
        
        // 按仓库分组
        var groupedBoxes: [String: [NSManagedObject]] = [:]
        
        for box in allBoxes {
            let repositoryName: String
            if let repository = box.value(forKey: "repository") as? NSManagedObject {
                repositoryName = repository.value(forKey: "name") as? String ?? "未知仓库"
            } else {
                repositoryName = "未知仓库"
            }
            
            if var boxes = groupedBoxes[repositoryName] {
                boxes.append(box)
                groupedBoxes[repositoryName] = boxes
            } else {
                groupedBoxes[repositoryName] = [box]
            }
        }
        
        // 对每个仓库内的盒子按名称排序
        var result: [BoxGroup] = []
        for (repoName, boxes) in groupedBoxes {
            let sortedBoxes = boxes.sorted { box1, box2 in
                let name1 = box1.value(forKey: "name") as? String ?? ""
                let name2 = box2.value(forKey: "name") as? String ?? ""
                return name1 < name2
            }
            result.append(BoxGroup(repositoryName: repoName, boxes: sortedBoxes))
        }
        
        // 对仓库按名称排序
        result.sort { $0.repositoryName < $1.repositoryName }
        
        return result
    }
    
    // 获取所有盒子
    private func getAllBoxes() -> [NSManagedObject] {
        var result: [NSManagedObject] = []
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
        do {
            result = try viewContext.fetch(fetchRequest)
        } catch {
            print("Error fetching boxes: \(error)")
        }
        return result
    }
    
    // 获取所有仓库
    private func getAllRepositories() -> [NSManagedObject] {
        var result: [NSManagedObject] = []
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Repository")
        fetchRequest.sortDescriptors = [NSSortDescriptor(key: "name", ascending: true)]
        do {
            result = try viewContext.fetch(fetchRequest)
        } catch {
            print("Error fetching repositories: \(error)")
        }
        return result
    }
    
    // 确保待定盒子仓库和待定零件盒子存在
    private func ensurePendingBoxRepositoryExists() {
        // 查找待定盒子仓库
        let repoFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Repository")
        repoFetchRequest.predicate = NSPredicate(format: "name == %@", "待定盒子")
        
        do {
            let repos = try viewContext.fetch(repoFetchRequest)
            if let repo = repos.first {
                pendingBoxRepository = repo
            } else {
                // 创建待定盒子仓库
                let newRepo = NSEntityDescription.insertNewObject(forEntityName: "Repository", into: viewContext)
                newRepo.setValue("待定盒子", forKey: "name")
                
                // 生成唯一ID
                let allRepoFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Repository")
                let allRepos = try viewContext.fetch(allRepoFetchRequest)
                let maxId = allRepos.compactMap { $0.value(forKey: "id") as? Int32 }.max() ?? 0
                newRepo.setValue(maxId + 1, forKey: "id")
                
                try viewContext.save()
                pendingBoxRepository = newRepo
            }
            
            // 查找待定零件盒子
            let boxFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
            boxFetchRequest.predicate = NSPredicate(format: "name == %@", "待定零件")
            
            let boxes = try viewContext.fetch(boxFetchRequest)
            if let box = boxes.first {
                pendingPartsBox = box
            } else if let pendingRepo = pendingBoxRepository {
                // 创建待定零件盒子
                let newBox = NSEntityDescription.insertNewObject(forEntityName: "Box", into: viewContext)
                newBox.setValue("待定零件", forKey: "name")
                
                // 生成唯一ID
                let allBoxFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
                let allBoxes = try viewContext.fetch(allBoxFetchRequest)
                let maxId = allBoxes.compactMap { $0.value(forKey: "id") as? Int32 }.max() ?? 0
                newBox.setValue(maxId + 1, forKey: "id")
                
                // 设置boxNumber
                let repoBoxFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
                let repoBoxes = try viewContext.fetch(repoBoxFetchRequest)
                let pendingRepoBoxes = repoBoxes.filter { 
                    if let boxRepo = $0.value(forKey: "repository") as? NSManagedObject {
                        return boxRepo.objectID == pendingRepo.objectID
                    }
                    return false
                }
                let maxBoxNumber = pendingRepoBoxes.compactMap { $0.value(forKey: "boxNumber") as? Int32 }.max() ?? 0
                newBox.setValue(maxBoxNumber + 1, forKey: "boxNumber")
                
                // 设置仓库关联
                newBox.setValue(pendingRepo, forKey: "repository")
                if let repoId = pendingRepo.value(forKey: "id") as? Int32 {
                    newBox.setValue(repoId, forKey: "repositoryId")
                }
                
                try viewContext.save()
                pendingPartsBox = newBox
            }
        } catch {
            print("Error ensuring pending box repository exists: \(error)")
        }
    }
    
    // 更改盒子仓库
    private func changeBoxesRepository() {
        guard !selectedBoxes.isEmpty, let targetRepo = selectedTargetRepository else {
            return
        }
        
        // 复制选中的盒子和目标仓库的objectID，避免在后台线程中访问self
        let selectedBoxObjectIDs = selectedBoxes.map { $0.objectID }
        let targetRepoObjectID = targetRepo.objectID
        
        // 在后台线程执行数据库操作，避免主线程阻塞
        DispatchQueue.global(qos: .userInitiated).async {
            // 创建后台上下文
            let backgroundContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            backgroundContext.parent = self.viewContext
            
            do {
                // 计算目标仓库中当前最大的boxNumber
                var currentMaxBoxNumber: Int32 = 0
                
                // 在后台上下文中获取所有盒子
                let boxFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
                let allBoxes = try backgroundContext.fetch(boxFetchRequest)
                
                // 确保目标仓库在后台上下文中
                let backgroundTargetRepo = backgroundContext.object(with: targetRepoObjectID)
                
                // 过滤出目标仓库的盒子
                let targetRepoBoxes = allBoxes.filter { 
                    if let boxRepository = $0.value(forKey: "repository") as? NSManagedObject {
                        return boxRepository.objectID == backgroundTargetRepo.objectID
                    }
                    return false
                }
                currentMaxBoxNumber = targetRepoBoxes.compactMap { $0.value(forKey: "boxNumber") as? Int32 }.max() ?? 0
                
                // 批量处理选中的盒子
                for boxObjectID in selectedBoxObjectIDs {
                    // 确保盒子在后台上下文中
                    let backgroundBox = backgroundContext.object(with: boxObjectID)
                    
                    // 更新盒子的repository关联
                    backgroundBox.setValue(backgroundTargetRepo, forKey: "repository")
                    if let repoId = backgroundTargetRepo.value(forKey: "id") as? Int32 {
                        backgroundBox.setValue(repoId, forKey: "repositoryId")
                    }
                    
                    // 分配新的boxNumber
                    currentMaxBoxNumber += 1
                    backgroundBox.setValue(currentMaxBoxNumber, forKey: "boxNumber")
                }
                
                // 一次性保存所有更改到后台上下文
                try backgroundContext.save()
                
                // 保存到主上下文
                DispatchQueue.main.async {
                    do {
                        try self.viewContext.save()
                        // 重置选中状态
                        self.selectedBoxes = []
                        self.selectedTargetRepository = nil
                        self.isChangingRepository = false
                    } catch {
                        print("Error saving to main context: \(error)")
                        self.isChangingRepository = false
                    }
                }
            } catch {
                print("Error changing box repository: \(error)")
                DispatchQueue.main.async {
                    self.isChangingRepository = false
                }
            }
        }
    }
    
    // 删除选中的盒子
    private func deleteSelectedBoxes() {
        guard !selectedBoxes.isEmpty, let pendingBox = pendingPartsBox else {
            return
        }
        
        // 复制待定盒子的objectID，避免在后台线程中访问self
        let pendingBoxObjectID = pendingBox.objectID
        
        // 显示处理中状态
        isDeleting = true
        
        // 在后台线程执行数据库操作，避免主线程阻塞
        DispatchQueue.global(qos: .userInitiated).async {
            // 使用主上下文的子上下文，确保操作的一致性
            let backgroundContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            backgroundContext.parent = self.viewContext
            
            do {
                // 在后台上下文中获取待定盒子
                let backgroundPendingBox = backgroundContext.object(with: pendingBoxObjectID)
                
                // 一次性获取所有选中盒子的零件
                let partFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
                // 创建谓词，使用objectID匹配所有选中的盒子
                let boxPredicates = self.selectedBoxes.map { box -> NSPredicate in
                    let backgroundBox = backgroundContext.object(with: box.objectID)
                    return NSPredicate(format: "box == %@", backgroundBox)
                }
                let compoundPredicate = NSCompoundPredicate(orPredicateWithSubpredicates: boxPredicates)
                partFetchRequest.predicate = compoundPredicate
                partFetchRequest.fetchBatchSize = 100
                
                let allParts = try backgroundContext.fetch(partFetchRequest)
                print("找到 \(allParts.count) 个零件需要移动")
                
                // 批量移动零件到待定盒子
                var processedCount = 0
                for part in allParts {
                    part.setValue(backgroundPendingBox, forKey: "box")
                    // 检查Part实体是否有boxId属性
                    let entity = part.entity
                    if entity.attributesByName.keys.contains("boxId"),
                       let boxId = backgroundPendingBox.value(forKey: "id") as? Int32 {
                        part.setValue(boxId, forKey: "boxId")
                    }
                    processedCount += 1
                    
                    // 每处理100个零件保存一次
                    if processedCount % 100 == 0 {
                        try backgroundContext.save()
                        print("已处理 \(processedCount) 个零件")
                    }
                }
                
                // 保存剩余的零件更改
                if processedCount % 100 != 0 {
                    try backgroundContext.save()
                    print("已处理完所有 \(processedCount) 个零件")
                }
                
                // 删除所有选中的盒子
                for box in self.selectedBoxes {
                    let backgroundBox = backgroundContext.object(with: box.objectID)
                    backgroundContext.delete(backgroundBox)
                }
                
                // 保存盒子删除操作
                try backgroundContext.save()
                print("已删除 \(self.selectedBoxes.count) 个盒子")
                
                // 保存到主上下文
                DispatchQueue.main.async {
                    do {
                        try self.viewContext.save()
                        // 重置选中状态
                        self.selectedBoxes = []
                        self.isDeleting = false
                        print("删除操作完成")
                    } catch {
                        print("Error saving to main context: \(error)")
                        self.isDeleting = false
                    }
                }
            } catch {
                print("Error deleting boxes: \(error)")
                DispatchQueue.main.async {
                    self.isDeleting = false
                }
            }
        }
    }
}
