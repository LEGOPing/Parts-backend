//
//  BoxManagementView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/14.
//

import SwiftUI
import CoreData

struct BoxManagementView: View {
    @Environment(\.managedObjectContext) private var viewContext
    @Binding var currentState: ViewState
    var repository: NSManagedObject
    @Binding var selectedBox: NSManagedObject?
    @State private var showNameEditSheet = false
    @State private var editName = ""
    @State private var editingBox: NSManagedObject?
    @State private var editingBoxName: String = ""
    @State private var refreshTrigger = UUID()
    @State private var showTransferSheet = false
    @State private var selectedBoxesForTransfer: [NSManagedObject] = []
    @State private var selectedTargetRepository: NSManagedObject?
    @State private var isLoading = false

    // 过滤当前仓库的盒子
    private var filteredBoxes: [NSManagedObject] {
        // 使用refreshTrigger来触发重新计算
        _ = refreshTrigger
        
        var result: [NSManagedObject] = []
        // 使用viewContext获取所有盒子
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
    private func getPartCount(for box: NSManagedObject) -> Int {
        return (box.value(forKey: "parts") as? Set<NSManagedObject>)?.count ?? 0
    }

    var body: some View {
        VStack {
            // 标题
            Text("\(repository.value(forKey: "name") as? String ?? "未命名仓库")仓库_盒子管理")
                .font(.system(size: 32, weight: .bold))
                .padding(.top, 20)
                .padding(.bottom, 10)
                .multilineTextAlignment(.center)
            
            // 按钮栏和数量统计
            HStack {
                Button(action: {
                    addBox()
                }) {
                    Text("添加盒子")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.blue)
                        .cornerRadius(10)
                        .shadow(radius: 2)
                }
                
                Button(action: {
                    showTransferSheet = true
                }) {
                    Text("盒子转仓")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.green)
                        .cornerRadius(10)
                        .shadow(radius: 2)
                }
                
                Spacer()
                
                // 盒子数量统计
                Text("共 \(filteredBoxes.count) 个盒子")
                    .font(.system(size: 16))
                    .foregroundColor(.gray)
                
                Spacer()
                
                Button(action: {
                    currentState = .repositoryManagement
                }) {
                    Text("返回仓库")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.red)
                        .cornerRadius(10)
                        .shadow(radius: 2)
                }
            }
            .padding(.horizontal, 30)
            .padding(.bottom, 20)
            
            // 盒子列表
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 15), count: 4), spacing: 20) {
                    ForEach(filteredBoxes, id: \.objectID) { box in
                        GeometryReader { geometry in
                            ZStack {
                                // 卡片背景
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(Color.white)
                                    .shadow(radius: 3, x: 0, y: 2)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10)
                                            .stroke(Color.blue.opacity(0.3), lineWidth: 1)
                                    )
                                
                                // 卡片内容
                                if editingBox?.objectID == box.objectID {
                                    // 编辑模式
                                    VStack(spacing: 0) {
                                        Spacer()
                                            .frame(height: geometry.size.height * 0.4) // 调整位置
                                        
                                        TextField("盒子名称", text: $editingBoxName, onCommit: {
                                            saveBoxName(box)
                                        })
                                            .font(.system(size: 18, weight: .bold)) // 缩小字体
                                            .foregroundColor(.primary)
                                            .multilineTextAlignment(.center)
                                            .padding(6)
                                            .background(Color.gray.opacity(0.1))
                                            .cornerRadius(6)
                                            .frame(maxWidth: .infinity)
                                        
                                        Spacer()
                                        
                                        // 盒子ID和零件数量 - 同一行左右两边
                                        HStack {
                                            Text("ID: \(box.value(forKey: "boxNumber") as? Int32 ?? 0)")
                                                .font(.system(size: 11))
                                                .foregroundColor(.gray)
                                            Spacer()
                                            Text("\(getPartCount(for: box)) 种")
                                                .font(.system(size: 11))
                                                .foregroundColor(.blue)
                                        }
                                    }
                                    .padding(15)
                                } else {
                                    // 正常模式
                                    VStack(spacing: 0) {
                                        Spacer()
                                            .frame(height: geometry.size.height * 0.4) // 调整位置
                                        
                                        // 盒子名称
                                        Text(box.value(forKey: "name") as? String ?? "未命名盒子")
                                            .font(.system(size: 18, weight: .bold)) // 缩小字体
                                            .foregroundColor(.primary)
                                            .lineLimit(2)
                                            .multilineTextAlignment(.center)
                                        
                                        Spacer()
                                        
                                        // 盒子ID和零件数量 - 同一行左右两边
                                        HStack {
                                            Text("ID: \(box.value(forKey: "boxNumber") as? Int32 ?? 0)")
                                                .font(.system(size: 11))
                                                .foregroundColor(.gray)
                                            Spacer()
                                            Text("\(getPartCount(for: box)) 种")
                                                .font(.system(size: 11))
                                                .foregroundColor(.blue)
                                        }
                                    }
                                    .padding(15)
                                }
                                
                                // 事件处理层 - 放在所有内容之上
                                if editingBox?.objectID != box.objectID {
                                    ZStack {
                                        Color.clear
                                            .contentShape(Rectangle())
                                            .simultaneousGesture(
                                                TapGesture()
                                                    .onEnded { _ in
                                                        print("点击盒子卡片，进入零件管理页面")
                                                        isLoading = true
                                                        // 延迟一小段时间，确保加载动画有足够时间显示
                                                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                                                            selectedBox = box
                                                            currentState = .partManagement(box)
                                                            isLoading = false
                                                        }
                                                    }
                                            )
                                            .simultaneousGesture(
                                                LongPressGesture(minimumDuration: 1.0)
                                                    .onEnded { _ in
                                                        print("长按盒子卡片，进入编辑模式")
                                                        startEditingBox(box)
                                                    }
                                            )
                                        
                                        // 加载状态 - 沙漏动画
                                        if isLoading {
                                            ZStack {
                                                Color.black.opacity(0.5)
                                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                                    .cornerRadius(10)
                                                HourglassAnimation()
                                                    .frame(width: 40, height: 40)
                                            }
                                        }
                                    }
                                }
                            }
                            .frame(height: geometry.size.width * 0.6) // 16:9.6 = 5:3 = 宽度 * 0.6
                        }
                    }
                }
                .padding(.horizontal, 30)
                .padding(.bottom, 30)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0xF5/255, green: 0xF5/255, blue: 0xF5/255))
        .sheet(isPresented: $showNameEditSheet) {
            VStack(spacing: 20) {
                Text("修改仓库名称")
                    .font(.system(size: 20, weight: .bold))
                    .padding(.top, 10)
                HStack(spacing: 15) {
                    TextField("仓库名称", text: $editName)
                        .font(.system(size: 16))
                        .padding(12)
                        .border(Color.gray.opacity(0.3))
                        .cornerRadius(8)
                        .frame(minWidth: 0, maxWidth: .infinity)
                        .textFieldStyle(.roundedBorder)
                    HStack(spacing: 12) {
                        Button(action: {
                            showNameEditSheet = false
                        }) {
                            Text("取消")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(Color.gray)
                                .cornerRadius(8)
                        }
                        Button(action: {
                            repository.setValue(editName, forKey: "name")
                            do {
                                try viewContext.save()
                                // 触发视图刷新
                                refreshTrigger = UUID()
                            } catch {
                                let nsError = error as NSError
                                fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
                            }
                            showNameEditSheet = false
                        }) {
                            Text("确定")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(Color.blue)
                                .cornerRadius(8)
                        }
                    }
                }
            }
            .padding(30)
            .frame(maxWidth: 500)
        }
        .sheet(isPresented: $showTransferSheet) {
            VStack(spacing: 20) {
                Text("盒子转仓")
                    .font(.system(size: 20, weight: .bold))
                    .padding(.top, 10)
                
                // 上面部分：盒子选择器（可多选）
                VStack(alignment: .leading, spacing: 10) {
                    Text("选择盒子")
                        .font(.system(size: 16, weight: .bold))
                    ScrollView {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 15) {
                            ForEach(filteredBoxes, id: \.objectID) {
                                box in
                                ZStack {
                                    // 卡片背景
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(selectedBoxesForTransfer.contains { $0.objectID == box.objectID } ? Color.blue.opacity(0.2) : Color.white)
                                        .stroke(selectedBoxesForTransfer.contains { $0.objectID == box.objectID } ? Color.blue : Color.gray.opacity(0.3), lineWidth: 2)
                                        .shadow(radius: 2)
                                    
                                    // 卡片内容
                                    VStack(spacing: 8) {
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
                                    if selectedBoxesForTransfer.contains(where: { $0.objectID == box.objectID }) {
                                        selectedBoxesForTransfer.removeAll(where: { $0.objectID == box.objectID })
                                    } else {
                                        selectedBoxesForTransfer.append(box)
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 10)
                    }
                    .frame(height: 240)
                }
                
                // 下面部分：目标仓库选择器（单选）
                VStack(alignment: .leading, spacing: 10) {
                    Text("选择目标仓库")
                        .font(.system(size: 16, weight: .bold))
                    ScrollView {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 15) {
                            ForEach(getAllRepositories(), id: \.objectID) {
                                repo in
                                if repo.objectID != repository.objectID {
                                    ZStack {
                                        // 卡片背景
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(selectedTargetRepository?.objectID == repo.objectID ? Color.green.opacity(0.2) : Color.white)
                                            .stroke(selectedTargetRepository?.objectID == repo.objectID ? Color.green : Color.gray.opacity(0.3), lineWidth: 2)
                                            .shadow(radius: 2)
                                        
                                        // 卡片内容
                                        VStack(spacing: 8) {
                                            Text(repo.value(forKey: "name") as? String ?? "未命名仓库")
                                                .font(.system(size: 14, weight: .bold))
                                                .multilineTextAlignment(.center)
                                                .lineLimit(2)
                                            Text("ID: \(repo.value(forKey: "id") as? Int32 ?? 0)")
                                                .font(.system(size: 12))
                                                .foregroundColor(.gray)
                                        }
                                        .padding(10)
                                    }
                                    .frame(height: 90)
                                    .onTapGesture {
                                        selectedTargetRepository = repo
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 10)
                    }
                    .frame(height: 120)
                }
                
                HStack(spacing: 12) {
                    Button(action: {
                        showTransferSheet = false
                        selectedBoxesForTransfer = []
                        selectedTargetRepository = nil
                    }) {
                        Text("取消")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 10)
                            .background(Color.gray)
                            .cornerRadius(8)
                    }
                    Button(action: {
                        transferBoxes()
                    }) {
                        Text("确定")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 10)
                            .background(Color.blue)
                            .cornerRadius(8)
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity)
        }
    }

    private func addBox() {
        withAnimation {
            // 使用环境提供的viewContext
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
            let repositoryBoxFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
            do {
                let allBoxes = try viewContext.fetch(repositoryBoxFetchRequest)
                let repositoryBoxes = allBoxes.filter { 
                    if let repoId = $0.value(forKey: "repositoryId") as? Int32,
                       let currentRepoId = repository.value(forKey: "id") as? Int32 {
                        return repoId == currentRepoId
                    }
                    return false
                }
                let maxBoxNumber = repositoryBoxes.compactMap { $0.value(forKey: "boxNumber") as? Int32 }.max() ?? 0
                newBox.setValue(maxBoxNumber + 1, forKey: "boxNumber")
            } catch {
                print("Error fetching repository boxes: \(error)")
                newBox.setValue(1, forKey: "boxNumber")
            }
            
            // 设置repositoryId
            if let repositoryId = repository.value(forKey: "id") as? Int32 {
                newBox.setValue(repositoryId, forKey: "repositoryId")
            }
            
            // 直接设置repository关联，使用同一个上下文的对象
            newBox.setValue(repository, forKey: "repository")

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

    private func startEditingBox(_ box: NSManagedObject) {
        editingBox = box
        editingBoxName = box.value(forKey: "name") as? String ?? ""
    }

    private func saveBoxName(_ box: NSManagedObject) {
        print("保存盒子名称: \(editingBoxName)")
        if !editingBoxName.isEmpty {
            box.setValue(editingBoxName, forKey: "name")
            do {
                try viewContext.save()
                print("保存成功")
                // 确保退出编辑模式
                editingBox = nil
                editingBoxName = ""
                // 立即刷新，不延迟
                refreshTrigger = UUID()
                print("刷新视图")
            } catch {
                let nsError = error as NSError
                print("保存错误: \(nsError)")
                fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
            }
        } else {
            // 如果输入为空，也退出编辑模式
            print("输入为空，退出编辑模式")
            editingBox = nil
            editingBoxName = ""
        }
    }

    private func saveContext() {
        do {
            try viewContext.save()
        } catch {
            let nsError = error as NSError
            fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
        }
    }
    
    // 获取所有仓库
    private func getAllRepositories() -> [NSManagedObject] {
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Repository")
        fetchRequest.sortDescriptors = [NSSortDescriptor(key: "name", ascending: true)]
        do {
            return try viewContext.fetch(fetchRequest)
        } catch {
            print("Error fetching repositories: \(error)")
            return []
        }
    }
    
    // 执行盒子转仓
    private func transferBoxes() {
        guard !selectedBoxesForTransfer.isEmpty, let targetRepo = selectedTargetRepository else {
            return
        }
        
        // 计算目标仓库中当前最大的boxNumber
        let repositoryBoxFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
        var currentMaxBoxNumber: Int32 = 0
        do {
            let allBoxes = try viewContext.fetch(repositoryBoxFetchRequest)
            let targetRepoBoxes = allBoxes.filter { 
                if let repoId = $0.value(forKey: "repositoryId") as? Int32,
                   let targetRepoId = targetRepo.value(forKey: "id") as? Int32 {
                    return repoId == targetRepoId
                }
                return false
            }
            currentMaxBoxNumber = targetRepoBoxes.compactMap { $0.value(forKey: "boxNumber") as? Int32 }.max() ?? 0
        } catch {
            print("Error fetching target repository boxes: \(error)")
        }
        
        // 批量处理选中的盒子
        for (_, box) in selectedBoxesForTransfer.enumerated() {
            // 更新盒子的repositoryId
            if let targetRepoId = targetRepo.value(forKey: "id") as? Int32 {
                box.setValue(targetRepoId, forKey: "repositoryId")
            }
            
            // 更新盒子的repository关联
            box.setValue(targetRepo, forKey: "repository")
            
            // 分配新的boxNumber
            currentMaxBoxNumber += 1
            box.setValue(currentMaxBoxNumber, forKey: "boxNumber")
        }
        
        do {
            try viewContext.save()
            // 触发视图刷新
            refreshTrigger = UUID()
            
            // 关闭sheet并重置状态
            showTransferSheet = false
            selectedBoxesForTransfer = []
            selectedTargetRepository = nil
        } catch {
            let nsError = error as NSError
            fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
        }
    }
}
