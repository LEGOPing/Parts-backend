//
//  WarehouseChangesView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/14.
//

import SwiftUI
import CoreData

struct WarehouseChangesView: View {
    @Binding var isPresented: Bool
    let viewContext: NSManagedObjectContext
    
    @State private var selectedRepository: NSManagedObject?
    @State private var showDeleteConfirmation = false
    @State private var pendingBoxRepository: NSManagedObject?
    
    var body: some View {
        VStack {
            Text("仓库变动")
                .font(.system(size: 24, weight: .bold))
                .padding()
            
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // 仓库删除
                    VStack(alignment: .leading, spacing: 12) {
                        Text("删除仓库")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.primary)
                        
                        // 仓库选择器
                        ScrollView {
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 15), count: 3), spacing: 20) {
                                ForEach(getAllRepositories(), id: \.objectID) { repository in
                                    let isSelected = selectedRepository?.objectID == repository.objectID
                                    let isPendingBox = repository.value(forKey: "name") as? String == "待定盒子"
                                    
                                    ZStack {
                                        // 卡片背景
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(isSelected ? Color.blue.opacity(0.2) : Color.white)
                                            .stroke(isSelected ? Color.blue : Color.gray.opacity(0.3), lineWidth: 2)
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
                                            Text("\(getBoxCount(for: repository)) 个盒子")
                                                .font(.system(size: 12))
                                                .foregroundColor(.blue)
                                        }
                                        .padding(12)
                                    }
                                    .frame(height: 100)
                                    .onTapGesture {
                                        if !isPendingBox {
                                            selectedRepository = repository
                                        }
                                    }
                                    .opacity(isPendingBox ? 0.5 : 1.0)
                                    .disabled(isPendingBox)
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 10)
                        }
                        
                        // 删除按钮
                        HStack {
                            Spacer()
                            Button(action: {
                                if selectedRepository != nil {
                                    showDeleteConfirmation.toggle()
                                }
                            }) {
                                Text("删除选中仓库")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 24)
                                    .padding(.vertical, 12)
                                    .background(selectedRepository != nil ? Color.red : Color.gray)
                                    .cornerRadius(8)
                            }
                            .disabled(selectedRepository == nil)
                            .padding(.trailing, 20)
                        }
                    }
                }
                .padding()
            }
            
            // 底部按钮
            HStack {
                Spacer()
                Button(action: {
                    isPresented = false
                }) {
                    Text("关闭")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(Color.gray)
                        .cornerRadius(8)
                }
                .padding()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0xF5/255, green: 0xF5/255, blue: 0xF5/255))
        .alert(isPresented: $showDeleteConfirmation) {
            Alert(
                title: Text("确认删除"),
                message: Text("确定要删除这个仓库吗？删除后仓库中的所有盒子将移到'待定盒子'仓库。"),
                primaryButton: .destructive(Text("删除")) {
                    if let repository = selectedRepository {
                        deleteRepository(repository)
                    }
                },
                secondaryButton: .cancel(Text("取消"))
            )
        }
        .onAppear {
            ensurePendingBoxRepositoryExists()
        }
    }
    
    // 获取所有仓库，排除待定盒子仓库
    private func getAllRepositories() -> [NSManagedObject] {
        var result: [NSManagedObject] = []
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Repository")
        fetchRequest.sortDescriptors = [NSSortDescriptor(key: "name", ascending: true)]
        do {
            let repos = try viewContext.fetch(fetchRequest)
            result = repos
        } catch {
            print("Error fetching repositories: \(error)")
        }
        return result
    }
    
    // 获取仓库中的盒子数量
    private func getBoxCount(for repository: NSManagedObject) -> Int {
        return (repository.value(forKey: "boxes") as? Set<NSManagedObject>)?.count ?? 0
    }
    
    // 确保待定盒子仓库存在
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
        } catch {
            print("Error ensuring pending box repository exists: \(error)")
        }
    }
    
    // 删除仓库，将盒子移到待定盒子仓库
    private func deleteRepository(_ repository: NSManagedObject) {
        guard let pendingRepo = pendingBoxRepository else {
            return
        }
        
        // 查找该仓库中的所有盒子
        let boxFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
        do {
            let allBoxes = try viewContext.fetch(boxFetchRequest)
            let repositoryBoxes = allBoxes.filter { 
                if let boxRepository = $0.value(forKey: "repository") as? NSManagedObject {
                    return boxRepository.objectID == repository.objectID
                }
                return false
            }
            
            // 计算待定盒子仓库中当前最大的boxNumber
            var currentMaxBoxNumber: Int32 = 0
            let pendingRepoBoxes = allBoxes.filter { 
                if let boxRepository = $0.value(forKey: "repository") as? NSManagedObject {
                    return boxRepository.objectID == pendingRepo.objectID
                }
                return false
            }
            currentMaxBoxNumber = pendingRepoBoxes.compactMap { $0.value(forKey: "boxNumber") as? Int32 }.max() ?? 0
            
            // 将盒子移到待定盒子仓库
            for (_, box) in repositoryBoxes.enumerated() {
                // 更新盒子的repository关联
                box.setValue(pendingRepo, forKey: "repository")
                if let repoId = pendingRepo.value(forKey: "id") as? Int32 {
                    box.setValue(repoId, forKey: "repositoryId")
                }
                
                // 分配新的boxNumber
                currentMaxBoxNumber += 1
                box.setValue(currentMaxBoxNumber, forKey: "boxNumber")
            }
            
            // 删除仓库
            viewContext.delete(repository)
            
            // 保存更改
            try viewContext.save()
            
            // 重置选中状态
            selectedRepository = nil
        } catch {
            print("Error deleting repository: \(error)")
        }
    }
}
