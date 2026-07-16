//
//  RepositoryManagementView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/14.
//

import SwiftUI
import CoreData

// 确保 ViewState 可用

struct RepositoryManagementView: View {
    @Environment(\.managedObjectContext) private var viewContext
    @Binding var currentState: ViewState
    @Binding var selectedRepository: NSManagedObject?
    @Binding var lastRepositoryId: Int32?
    @State private var showDeleteConfirmation = false
    @State private var selectedRepoForDelete: NSManagedObject?
    @State private var editingRepo: NSManagedObject?
    @State private var editingName: String = ""
    @State private var refreshTrigger = UUID()
    @State private var selectedRepoForDisplay: NSManagedObject? // 用于显示选中状态
    
    // 盒子编辑相关状态
    @State private var editingBox: NSObject?
    @State private var editingBoxName: String = ""

    // 获取所有仓库，将"待定盒子"放在最后
    private func getAllRepositories() -> [NSManagedObject] {
        // 使用refreshTrigger来触发重新计算
        _ = refreshTrigger
        
        var result: [NSManagedObject] = []
        // 使用viewContext获取所有仓库
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Repository")
        fetchRequest.sortDescriptors = [NSSortDescriptor(key: "name", ascending: true)]
        do {
            let allRepos = try viewContext.fetch(fetchRequest)
            // 将"待定盒子"放在最后
            var regularRepos: [NSManagedObject] = []
            var pendingBoxRepo: NSManagedObject?
            
            for repo in allRepos {
                if repo.value(forKey: "name") as? String == "待定盒子" {
                    pendingBoxRepo = repo
                } else {
                    regularRepos.append(repo)
                }
            }
            
            result = regularRepos
            if let pendingRepo = pendingBoxRepo {
                result.append(pendingRepo)
            }
        } catch {
            print("Error fetching repositories: \(error)")
        }
        return result
    }

    // 获取仓库中的盒子数量
    private func getBoxCount(for repository: NSManagedObject) -> Int {
        return (repository.value(forKey: "boxes") as? Set<NSManagedObject>)?.count ?? 0
    }
    
    // 获取指定仓库中的所有盒子
    private func getBoxesForRepository(_ repository: NSManagedObject) -> [NSManagedObject] {
        var result: [NSManagedObject] = []
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
        fetchRequest.sortDescriptors = [NSSortDescriptor(key: "boxNumber", ascending: true)]
        do {
            let allBoxes = try viewContext.fetch(fetchRequest)
            for box in allBoxes {
                if let boxRepository = box.value(forKey: "repository") as? NSManagedObject {
                    if boxRepository.objectID == repository.objectID {
                        result.append(box)
                    }
                }
            }
        } catch {
            print("Error fetching boxes: \(error)")
        }
        return result
    }
    
    // 获取盒子中的零件数量
    private func getPartCount(for box: NSObject) -> Int {
        return (box.value(forKey: "parts") as? Set<NSObject>)?.count ?? 0
    }
    
    // 检查盒子是否使用默认名称
    private func isDefaultBoxName(_ box: NSObject) -> Bool {
        if let boxName = box.value(forKey: "name") as? String {
            return boxName == "新盒子"
        }
        return false
    }
    
    // 在指定仓库中添加盒子
    private func addBox(to repository: NSManagedObject) {
        withAnimation {
            let newBox = NSEntityDescription.insertNewObject(forEntityName: "Box", into: viewContext)
            newBox.setValue("新盒子", forKey: "name")
            
            // 生成唯一ID
            let boxFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
            do {
                let boxes = try viewContext.fetch(boxFetchRequest)
                let maxId = boxes.compactMap { $0.value(forKey: "id") as? Int32 }.max() ?? 0
                newBox.setValue(maxId + 1, forKey: "id")
            } catch {
                print("Error fetching boxes: \(error)")
                newBox.setValue(1, forKey: "id")
            }
            
            // 计算新盒子的boxNumber，确保在当前仓库中唯一
            let repositoryBoxes = getBoxesForRepository(repository)
            let maxBoxNumber = repositoryBoxes.compactMap { $0.value(forKey: "boxNumber") as? Int32 }.max() ?? 0
            newBox.setValue(maxBoxNumber + 1, forKey: "boxNumber")
            
            // 设置仓库关联
            newBox.setValue(repository, forKey: "repository")
            if let repoId = repository.value(forKey: "id") as? Int32 {
                newBox.setValue(repoId, forKey: "repositoryId")
            }
            
            do {
                try viewContext.save()
                // 触发视图刷新
                refreshTrigger = UUID()
            } catch {
                let nsError = error as NSError
                fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
            }
        }
    }
    
    // 添加仓库
    private func addRepository() {
        withAnimation {
            let newRepository = NSEntityDescription.insertNewObject(forEntityName: "Repository", into: viewContext)
            newRepository.setValue("新仓库", forKey: "name")
            
            // 生成唯一ID
            let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Repository")
            do {
                let repositories = try viewContext.fetch(fetchRequest)
                let maxId = repositories.compactMap { $0.value(forKey: "id") as? Int32 }.max() ?? 0
                newRepository.setValue(maxId + 1, forKey: "id")
            } catch {
                print("Error fetching repositories: \(error)")
                newRepository.setValue(1, forKey: "id")
            }

            do {
                try viewContext.save()
                // 触发视图刷新
                refreshTrigger = UUID()
            } catch {
                let nsError = error as NSError
                fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
            }
        }
    }

    // 删除仓库
    private func deleteRepository(_ repository: NSManagedObject) {
        withAnimation {
            viewContext.delete(repository)
            do {
                try viewContext.save()
                // 触发视图刷新
                refreshTrigger = UUID()
            } catch {
                let nsError = error as NSError
                fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
            }
        }
    }
    
    // 开始编辑仓库名称
    private func startEditing(_ repository: NSManagedObject) {
        editingRepo = repository
        editingName = repository.value(forKey: "name") as? String ?? ""
    }
    
    // 保存仓库名称
    private func saveRepositoryName(_ repository: NSManagedObject) {
        // 检查是否是"待定盒子"仓库，如果是则不允许修改名称
        if let currentName = repository.value(forKey: "name") as? String, currentName == "待定盒子" {
            // 退出编辑模式
            editingRepo = nil
            editingName = ""
            return
        }
        
        if !editingName.isEmpty {
            repository.setValue(editingName, forKey: "name")
            do {
                try viewContext.save()
                // 确保退出编辑模式
                editingRepo = nil
                editingName = ""
                // 延迟一下再刷新，确保UI有时间响应
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    // 触发视图刷新
                    refreshTrigger = UUID()
                }
            } catch {
                let nsError = error as NSError
                fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
            }
        } else {
            // 如果输入为空，也退出编辑模式
            editingRepo = nil
            editingName = ""
        }
    }
    
    // 开始编辑盒子名称
    private func startEditingBox(_ box: NSObject) {
        // 检查是否是"待定零件"盒子，如果是则不允许修改名称
        if let boxName = box.value(forKey: "name") as? String, boxName == "待定零件" {
            return
        }
        
        editingBox = box
        editingBoxName = box.value(forKey: "name") as? String ?? ""
    }
    
    // 保存盒子名称
    private func saveBoxName(_ box: NSObject) {
        // 检查是否是"待定零件"盒子，如果是则不允许修改名称
        if let boxName = box.value(forKey: "name") as? String, boxName == "待定零件" {
            // 退出编辑模式
            editingBox = nil
            editingBoxName = ""
            return
        }
        
        if !editingBoxName.isEmpty {
            box.setValue(editingBoxName, forKey: "name")
            do {
                try viewContext.save()
                // 确保退出编辑模式
                editingBox = nil
                editingBoxName = ""
                // 延迟一下再刷新，确保UI有时间响应
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    // 触发视图刷新
                    refreshTrigger = UUID()
                }
            } catch {
                let nsError = error as NSError
                fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
            }
        } else {
            // 如果输入为空，也退出编辑模式
            editingBox = nil
            editingBoxName = ""
        }
    }

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 20) {
                // 上部分：仓库管理
                VStack(alignment: .leading, spacing: 10) {
                    // 标题和添加按钮
                    HStack {
                        Text("仓库管理")
                            .font(.system(size: 24, weight: .bold))
                        Spacer()
                        Button(action: {
                            addRepository()
                        }) {
                            Text("添加仓库")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .background(Color.blue)
                                .cornerRadius(8)
                                .shadow(radius: 2)
                        }
                    }
                    .padding(.horizontal, 30)
                    .padding(.top, 20)
                    
                    // 仓库数量统计
                    Text("共 \(getAllRepositories().count) 个仓库")
                        .font(.system(size: 14))
                        .foregroundColor(.gray)
                        .padding(.horizontal, 30)
                    
                    // 仓库列表 - 水平滚动
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 20) {
                            ForEach(getAllRepositories(), id: \.objectID) { repository in
                                VStack {
                                    // 仓库卡片
                                    GeometryReader { geometry in
                                        ZStack {
                                            // 卡片背景
                                            RoundedRectangle(cornerRadius: 12)
                                                .fill(selectedRepoForDisplay?.objectID == repository.objectID ? Color.blue.opacity(0.1) : Color.white)
                                                .shadow(radius: 4, x: 0, y: 2)
                                                .overlay(
                                                    RoundedRectangle(cornerRadius: 12)
                                                        .stroke(selectedRepoForDisplay?.objectID == repository.objectID ? Color.blue : Color.blue.opacity(0.3), lineWidth: 1)
                                                )
                                            
                                            // 卡片内容
                                            if editingRepo?.objectID == repository.objectID {
                                                // 编辑模式
                                                VStack(spacing: 4) {
                                                    // 仓库名称输入框
                                                    TextField("仓库名称", text: $editingName, onCommit: {
                                                        saveRepositoryName(repository)
                                                    })
                                                        .font(.system(size: 14, weight: .bold))
                                                        .foregroundColor(.primary)
                                                        .multilineTextAlignment(.center)
                                                        .padding(4)
                                                        .background(Color.gray.opacity(0.1))
                                                        .cornerRadius(6)
                                                        .frame(maxWidth: .infinity)
                                                    
                                                    // ID和盒子数量 - 同一行左右两边
                                                    HStack {
                                                        Text("ID: \(repository.value(forKey: "id") as? Int32 ?? 0)")
                                                            .font(.system(size: 10))
                                                            .foregroundColor(.gray)
                                                        Spacer()
                                                        Text("\(getBoxCount(for: repository)) 盒")
                                                            .font(.system(size: 10))
                                                            .foregroundColor(.blue)
                                                    }
                                                }
                                                .padding(10)
                                            } else {
                                                // 正常模式
                                                VStack(spacing: 4) {
                                                    // 仓库名称
                                                    Text(repository.value(forKey: "name") as? String ?? "未命名仓库")
                                                        .font(.system(size: 14, weight: .bold))
                                                        .foregroundColor(.primary)
                                                        .lineLimit(2)
                                                        .multilineTextAlignment(.center)
                                                    
                                                    // ID和盒子数量 - 同一行左右两边
                                                    HStack {
                                                        Text("ID: \(repository.value(forKey: "id") as? Int32 ?? 0)")
                                                            .font(.system(size: 10))
                                                            .foregroundColor(.gray)
                                                        Spacer()
                                                        Text("\(getBoxCount(for: repository)) 盒")
                                                            .font(.system(size: 10))
                                                            .foregroundColor(.blue)
                                                    }
                                                }
                                                .padding(10)
                                            }
                                            
                                            // 事件处理层 - 放在所有内容之上
                                            if editingRepo?.objectID != repository.objectID {
                                                Color.clear
                                                    .contentShape(Rectangle())
                                                    .simultaneousGesture(
                                                        TapGesture()
                                                            .onEnded { _ in
                                                                print("点击仓库卡片，选择仓库")
                                                                selectedRepository = repository
                                                                selectedRepoForDisplay = repository // 更新选中状态
                                                                // 更新lastRepositoryId
                                                                if let repoId = repository.value(forKey: "id") as? Int32 {
                                                                    lastRepositoryId = repoId
                                                                    UserDefaults.standard.set(repoId, forKey: "lastRepositoryId")
                                                                }
                                                            }
                                                    )
                                                    .simultaneousGesture(
                                                        LongPressGesture(minimumDuration: 1.0)
                                                            .onEnded { _ in
                                                                // 禁止"待定盒子"仓库的长按改名功能
                                                                let isPendingBox = repository.value(forKey: "name") as? String == "待定盒子"
                                                                if !isPendingBox {
                                                                    print("长按仓库卡片，进入编辑模式")
                                                                    startEditing(repository)
                                                                }
                                                            }
                                                    )
                                            }
                                        }
                                    }
                                    .frame(width: 180, height: 80)
                                }
                            }
                        }
                        .padding(.horizontal, 30)
                        .padding(.bottom, 10)
                    }
                }
                .frame(height: 200) // 固定上部高度为200
                
                // 下部分：盒子管理
                if let selectedRepo = selectedRepository {
                    VStack(alignment: .leading, spacing: 10) {
                        // 标题和添加按钮
                        HStack {
                            Text("\(selectedRepo.value(forKey: "name") as? String ?? "未命名仓库") - 盒子管理")
                                .font(.system(size: 24, weight: .bold))
                            Spacer()
                            Button(action: {
                                addBox(to: selectedRepo)
                            }) {
                                Text("添加盒子")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 8)
                                    .background(Color.green)
                                    .cornerRadius(8)
                                    .shadow(radius: 2)
                            }
                        }
                        .padding(.horizontal, 30)
                        
                        // 盒子数量统计
                        Text("共 \(getBoxesForRepository(selectedRepo).count) 个盒子")
                            .font(.system(size: 14))
                            .foregroundColor(.gray)
                            .padding(.horizontal, 30)
                        
                        // 盒子列表
                        ScrollView {
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20), count: 5), spacing: 20) {
                                ForEach(getBoxesForRepository(selectedRepo), id: \.objectID) { box in
                                    VStack {
                                        // 盒子卡片
                                        GeometryReader { geometry in
                                            ZStack {
                                                // 卡片背景
                                                RoundedRectangle(cornerRadius: 10)
                                                    .fill(isDefaultBoxName(box) ? Color.yellow.opacity(0.1) : Color.white)
                                                    .shadow(radius: 3, x: 0, y: 2)
                                                    .overlay(
                                                        RoundedRectangle(cornerRadius: 10)
                                                            .stroke(isDefaultBoxName(box) ? Color.yellow : Color.blue.opacity(0.3), lineWidth: 1)
                                                    )
                                                
                                                // 卡片内容
                                                if editingBox === box {
                                                    // 编辑模式
                                                    VStack(spacing: 6) {
                                                        // 盒子名称输入框
                                                        TextField("盒子名称", text: $editingBoxName, onCommit: {
                                                            saveBoxName(box)
                                                        })
                                                            .font(.system(size: 14, weight: .bold))
                                                            .foregroundColor(.primary)
                                                            .multilineTextAlignment(.center)
                                                            .padding(4)
                                                            .background(Color.gray.opacity(0.1))
                                                            .cornerRadius(6)
                                                            .frame(maxWidth: .infinity)
                                                        Text("ID: \(box.value(forKey: "boxNumber") as? Int32 ?? 0)")
                                                            .font(.system(size: 12))
                                                            .foregroundColor(.gray)
                                                        Text("\(getPartCount(for: box)) 种零件")
                                                            .font(.system(size: 12))
                                                            .foregroundColor(.blue)
                                                    }
                                                    .padding(12)
                                                } else {
                                                    // 正常模式
                                                    VStack(spacing: 6) {
                                                        Text(box.value(forKey: "name") as? String ?? "未命名盒子")
                                                            .font(.system(size: 14, weight: .bold))
                                                            .multilineTextAlignment(.center)
                                                            .lineLimit(2)
                                                        Text("ID: \(box.value(forKey: "boxNumber") as? Int32 ?? 0)")
                                                            .font(.system(size: 12))
                                                            .foregroundColor(.gray)
                                                        Text("\(getPartCount(for: box)) 种零件")
                                                            .font(.system(size: 12))
                                                            .foregroundColor(.blue)
                                                    }
                                                    .padding(12)
                                                }
                                                
                                                // 事件处理层 - 放在所有内容之上
                                                if editingBox !== box {
                                                    Color.clear
                                                        .contentShape(Rectangle())
                                                        .simultaneousGesture(
                                                            TapGesture()
                                                                .onEnded { _ in
                                                                    print("点击盒子卡片，进入零件管理页面")
                                                                    currentState = .partManagement(box)
                                                                }
                                                        )
                                                        .simultaneousGesture(
                                                            LongPressGesture(minimumDuration: 1.0)
                                                                .onEnded { _ in
                                                                    // 检查是否是"待定零件"盒子，如果是则不允许修改名称
                                                                    let isPendingParts = box.value(forKey: "name") as? String == "待定零件"
                                                                    if !isPendingParts {
                                                                        print("长按盒子卡片，进入编辑模式")
                                                                        startEditingBox(box)
                                                                    }
                                                                }
                                                        )
                                                }
                                            }
                                        }
                                        .frame(width: 150, height: 120) // 固定宽度和高度，避免上下遮挡
                                    }
                                }
                            }
                            .padding(.horizontal, 30)
                            .padding(.bottom, 30)
                        }
                    }
                    .frame(maxHeight: .infinity) // 下部占用剩余高度
                } else {
                    // 未选择仓库时的提示
                    VStack {
                        Text("请选择一个仓库查看盒子")
                            .font(.system(size: 16))
                            .foregroundColor(.gray)
                    }
                    .frame(maxHeight: .infinity) // 占用剩余高度
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0xF5/255, green: 0xF5/255, blue: 0xF5/255))
        .ignoresSafeArea(.keyboard) // 忽略键盘影响
        .alert(isPresented: $showDeleteConfirmation) {
            Alert(
                title: Text("确认删除"),
                message: Text("确定要删除这个仓库吗？删除后将同时删除仓库中的所有盒子和零件。"),
                primaryButton: .destructive(Text("删除")) {
                    if let repository = selectedRepoForDelete {
                        deleteRepository(repository)
                    }
                },
                secondaryButton: .cancel(Text("取消"))
            )
        }
        .onAppear {
            // 确保选中状态同步
            selectedRepoForDisplay = selectedRepository
        }
    }
}
